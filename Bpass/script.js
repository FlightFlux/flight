/**
 * BCBP Parser
 * Parse IATA Bar Coded Boarding Pass format
 * Based on IATA Resolution 792 - https://www.iata.org/contentassets/1dccc9ed041b4f3bbdcf8ee8682e75c4/2021_03_02-bcbp-implementation-guide-version-7-.pdf
 */

// Main parsing function
function parseBCBP(rawData) {
  // Validate input
  if (!rawData || typeof rawData !== 'string') {
    throw new Error('Invalid barcode data');
  }

  // Sanitize input and ensure basic format
  const data = rawData.trim();
  
  // Basic validation - check if string is long enough for mandatory fields
  if (data.length < 60) {
    throw new Error('Barcode data is too short (must be at least 60 characters)');
  }

  console.log('Parsing BCBP data:', data);
  
  try {
    // Parse full BCBP data according to IATA specification
    const result = {
      // Mandatory fields - first 60 characters
      formatCode: data.charAt(0),
      numberOfLegs: data.charAt(1),
      passengerName: data.substring(2, 22).trim(),
      electronicTicketIndicator: data.charAt(22),
      pnr: data.substring(23, 30).trim(),
      origin: data.substring(30, 33),
      destination: data.substring(33, 36),
      airline: data.substring(36, 39),
      flightNumber: data.substring(39, 44).trim(),
      date: convertJulianDateToCalendar(data.substring(44, 47)),
      class: data.charAt(47),
      seat: data.substring(48, 52).trim(),
      checkinSequenceNumber: data.substring(52, 57).trim(),
      passengerStatus: data.charAt(57),
      structuredDataSize: data.substring(58, 60),
      checkedIn: data.charAt(57) === '1' || data.charAt(57) === '2', // 1 = checked in, 2 = boarded
    };
    
    // Format code validation - should be 'M' for BCBP
    if (result.formatCode !== 'M') {
      throw new Error('Not a valid boarding pass format (must start with M)');
    }
    
    console.log('Format code validated successfully');
    
    // Handle passenger name if it contains a slash (LASTNAME/FIRSTNAME)
    if (result.passengerName.includes('/')) {
      const parts = result.passengerName.split('/');
      // Format as "FIRSTNAME LASTNAME" 
      result.passengerName = `${parts[1].trim()} ${parts[0].trim()}`;
    }
    
    // Handle airline code special cases (some common misreads)
    if (result.airline === 'PAA') {
      result.airline = 'AA'; // American Airlines
    } else if (result.airline === 'PUA') {
      result.airline = 'UA'; // United Airlines
    } else if (result.airline === 'PQF') {
      result.airline = 'QF'; // Qantas
    } 
    // Check last two characters if we have a 3-char code that might be misread
    else if (result.airline.length === 3 && 
            (result.airline.startsWith('P') || result.airline.startsWith('O'))) {
      const potentialCode = result.airline.substring(1);
      // Check against common airline codes
      if (['AA', 'UA', 'DL', 'QF', 'BA'].includes(potentialCode)) {
        result.airline = potentialCode;
      }
    }
    
    // Seat formatting - handle various formats
    if (result.seat) {
      // Format C008F (class + number + letter)
      if (/^[A-Za-z]\d+[A-Za-z]$/.test(result.seat)) {
        const match = result.seat.match(/^[A-Za-z](\d+)([A-Za-z])$/);
        if (match) {
          const [, digits, letter] = match;
          // Remove leading zeros from the number part
          const number = parseInt(digits, 10).toString();
          result.seat = number + letter;
        }
      } 
      // Format 008F (digits + letter) 
      else if (/^\d+[A-Za-z]$/.test(result.seat)) {
        const match = result.seat.match(/^(\d+)([A-Za-z])$/);
        if (match) {
          const [, digits, letter] = match;
          // Remove leading zeros from the number part
          const number = parseInt(digits, 10).toString();
          result.seat = number + letter;
        }
      }
      // Format 00000 - possibly unassigned seat
      else if (/^0+$/.test(result.seat)) {
        result.seat = "Unassigned";
      }
    }
    
    // Parse conditional and optional fields if they exist (after 60th character)
    if (data.length > 60) {
      result.versionIndicator = data.charAt(60);
      result.versionNumber = data.charAt(61);
      
      // Parse optional fields if present (beyond char 62)
      if (data.length > 62) {
        result.optionalFields = parseOptionalFields(data.substring(62));
      }
    }
    
    // Log the parsed data for debugging
    console.log('Parsed BCBP data:', result);
    
    return result;
  } catch (error) {
    console.error('Error parsing BCBP:', error);
    throw new Error('Failed to parse boarding pass data');
  }
}

/**
 * Parse optional fields section in the barcode data
 */
function parseOptionalFields(optionalData) {
  const fields = [];
  let pos = 0;
  
  try {
    while (pos < optionalData.length) {
      // Need at least 2 characters for size field
      if (pos + 2 > optionalData.length) break;
      
      // Read field size (2 hex digits)
      const sizeHex = optionalData.substring(pos, pos + 2);
      let size;
      try {
        size = parseInt(sizeHex, 16);
        if (isNaN(size)) break;
      } catch {
        break;
      }
      
      pos += 2;
      
      // Ensure we have enough characters left
      if (pos + size > optionalData.length) break;
      
      // Extract the field data
      const fieldData = optionalData.substring(pos, pos + size);
      pos += size;
      
      // Add to our collection with a description
      fields.push({ 
        data: fieldData, 
        description: identifyField(fieldData) 
      });
    }
  } catch (error) {
    console.error('Error parsing optional fields:', error);
  }
  
  return fields;
}

/**
 * Identify the type of optional field based on its format
 */
function identifyField(fieldData) {
  if (fieldData.match(/^[A-Z]{2}\s*\d+$/)) {
    return "Frequent Flyer Number";
  }
  if (fieldData.match(/^\d{10,}$/)) {
    return "Baggage Tag License Plate";
  }
  if (fieldData.length === 1 && fieldData.match(/^\d$/)) {
    return "Check-in Source";
  }
  if (fieldData.length === 1 && fieldData.match(/^[0-3]$/)) {
    return "Selectee Indicator";
  }
  if (fieldData.match(/^[Y|N|T]$/)) {
    return "Fast Track";
  }
  return "Additional Data";
}

/**
 * Enhanced Julian date conversion that handles the year digit
 */
function convertJulianDateToCalendar(julianDate) {
  try {
    if (julianDate.length !== 3) return "Invalid date";
    
    const yearDigit = parseInt(julianDate.charAt(0), 10);
    const dayOfYear = parseInt(julianDate.substring(1), 10);
    
    if (isNaN(dayOfYear) || dayOfYear < 1 || dayOfYear > 366) {
      return 'Invalid date';
    }
    
    // Determine the full year based on current year
    const currentYear = new Date().getFullYear();
    const currentDecade = Math.floor(currentYear / 10) * 10;
    let fullYear = currentDecade + yearDigit;
    
    // If the resulting year is more than 2 years in the future, 
    // assume it's from the previous decade
    if (fullYear > currentYear + 2) {
      fullYear -= 10;
    }
    
    const jan1 = new Date(fullYear, 0, 1);
    const date = new Date(jan1.getTime() + (dayOfYear - 1) * 24 * 60 * 60 * 1000);
    
    // Format the date as "Month Day" (e.g., "April 16")
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  } catch (error) {
    console.error('Error converting Julian date:', error);
    return 'Unknown date';
  }
}

/**
 * Get human-readable cabin class name from class code
 */
function getCabinClassName(classCode) {
  const classes = {
    'F': 'First Class',
    'A': 'First Class',
    'P': 'First Class Premium',
    'J': 'Business Class',
    'C': 'Business Class',
    'D': 'Business Class',
    'I': 'Business Class',
    'Z': 'Business Class',
    'W': 'Premium Economy',
    'S': 'Premium Economy',
    'Y': 'Economy',
    'M': 'Economy',
    'B': 'Economy',
    'H': 'Economy',
    'K': 'Economy',
    'L': 'Economy',
    'Q': 'Economy',
    'T': 'Economy',
    'V': 'Economy'
  };
  return classes[classCode] || `Class ${classCode}`;
}

/**
 * Get human-readable passenger status from status code
 */
function getPassengerStatus(code) {
  const statuses = {
    '0': 'Ticket Issuance/Ticket Change',
    '1': 'Checked-in',
    '2': 'Boarded',
    '3': 'Standby',
    '4': 'Gate Change'
  };
  return statuses[code] || `Status ${code}`;
}

/**
 * Format a field breakdown for display
 */
function formatDataBreakdown(data) {
  let breakdown = "Field positions breakdown:\n\n";
  
  // Only try to parse the data if we have enough characters
  if (data.length < 30) {
    return `Data too short for breakdown (length: ${data.length})`;
  }
  
  try {
    // Mandatory fields breakdown (first 60 characters)
    const fields = [
      { range: [0, 1], label: "Format Code" },
      { range: [1, 2], label: "Number of Legs" },
      { range: [2, 22], label: "Passenger Name" },
      { range: [22, 23], label: "Electronic Ticket Indicator" },
      { range: [23, 30], label: "PNR/Booking Reference" },
      { range: [30, 33], label: "From Airport" },
      { range: [33, 36], label: "To Airport" },
      { range: [36, 39], label: "Airline Code" },
      { range: [39, 44], label: "Flight Number" },
      { range: [44, 47], label: "Julian Date" },
      { range: [47, 48], label: "Cabin Class" },
      { range: [48, 52], label: "Seat Number" },
      { range: [52, 57], label: "Check-in Sequence Number" },
      { range: [57, 58], label: "Passenger Status" },
      { range: [58, 60], label: "Structured Data Size" }
    ];
    
    // Add each field to the breakdown
    fields.forEach(field => {
      const [start, end] = field.range;
      if (data.length >= end) {
        const value = data.substring(start, end);
        breakdown += `[${start}-${end-1}] ${field.label}: "${value}"\n`;
      }
    });
    
    // Add conditional fields if present
    if (data.length > 60) {
      breakdown += `[60] Version Indicator: "${data.charAt(60)}"\n`;
      
      if (data.length > 61) {
        breakdown += `[61] Version Number: "${data.charAt(61)}"\n`;
        
        if (data.length > 62) {
          breakdown += `[62+] Optional Fields: "${data.substring(62)}"\n`;
        }
      }
    }
    
    return breakdown;
  } catch (error) {
    console.error("Error formatting data breakdown:", error);
    return "Error generating breakdown";
  }
}

// Flight Status API functions
async function fetchFlightStatus(airline, flightNumber, date) {
  try {
    const flightStatusDiv = document.getElementById('flight-status');
    flightStatusDiv.innerHTML = '<div class="loading-spinner"></div> Fetching flight status...';
    
    // Extract date components from the date string (e.g., "April 16")
    const dateParts = date.split(' ');
    if (dateParts.length !== 2) {
      throw new Error('Invalid date format');
    }
    
    const month = dateParts[0]; // e.g., "April"
    const day = parseInt(dateParts[1], 10); // e.g., 16
    
    // Get current year
    const currentYear = new Date().getFullYear();
    
    // Create date object for the flight date
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthIndex = months.indexOf(month);
    if (monthIndex === -1) {
      throw new Error('Invalid month name');
    }
    
    let flightDate = new Date(currentYear, monthIndex, day);
    
    // If the date is in the past (more than 30 days), assume it's next year
    const now = new Date();
    if (flightDate < now && (now - flightDate) > 30 * 24 * 60 * 60 * 1000) {
      flightDate = new Date(currentYear + 1, monthIndex, day);
    }
    
    // Format date as YYYY-MM-DD for the API
    const formattedDate = `${flightDate.getFullYear()}-${(flightDate.getMonth() + 1).toString().padStart(2, '0')}-${flightDate.getDate().toString().padStart(2, '0')}`;
    
    // API call to fetch flight status
    // Note: This is just a placeholder for the API call
    // In a real application, you would make an actual API call to a flight status service
    const apiKey = 'YOUR_AVIATION_API_KEY'; // This would be your actual API key
    
    // Simulate API call with timeout
    setTimeout(() => {
      // This is simulated data - in a real application, you would parse the API response
      displayFlightStatus({
        flightNumber: `${airline}${flightNumber}`,
        status: getRandomStatus(),
        scheduledDeparture: `${formattedDate}T${getRandomTime()}`,
        estimatedDeparture: `${formattedDate}T${getRandomTime()}`,
        departureGate: getRandomGate(),
        departureTerminal: getRandomTerminal(),
        arrivalGate: getRandomGate(),
        arrivalTerminal: getRandomTerminal(),
        estimatedArrival: `${formattedDate}T${getRandomTime(true)}`,
      });
    }, 1500);
    
  } catch (error) {
    console.error('Error fetching flight status:', error);
    const flightStatusDiv = document.getElementById('flight-status');
    flightStatusDiv.innerHTML = `
      <div class="status-card error">
        <h3>Flight Status Unavailable</h3>
        <p>Could not retrieve flight status at this time. Please check with your airline directly.</p>
        <div class="status-actions">
          <button id="retry-status" class="btn btn-secondary">Retry</button>
        </div>
      </div>
    `;
    
    // Add retry button event listener
    document.getElementById('retry-status').addEventListener('click', () => {
      fetchFlightStatus(airline, flightNumber, date);
    });
  }
}

function getRandomStatus() {
  const statuses = [
    "On Time", 
    "Delayed", 
    "Boarding", 
    "In Air", 
    "Landed", 
    "Cancelled"
  ];
  return statuses[Math.floor(Math.random() * statuses.length)];
}

function getRandomTime(isArrival = false) {
  const hours = Math.floor(Math.random() * 24).toString().padStart(2, '0');
  const minutes = Math.floor(Math.random() * 60).toString().padStart(2, '0');
  
  if (isArrival) {
    // Add a few hours for arrival time
    const arrivalHours = (parseInt(hours) + 2 + Math.floor(Math.random() * 3)) % 24;
    return `${arrivalHours.toString().padStart(2, '0')}:${minutes}:00`;
  }
  
  return `${hours}:${minutes}:00`;
}

function getRandomGate() {
  const gates = ["A1", "A2", "B3", "C4", "D5", "E6", "F7", "G8", "H9"];
  return gates[Math.floor(Math.random() * gates.length)];
}

function getRandomTerminal() {
  const terminals = ["1", "2", "3", "4", "International"];
  return terminals[Math.floor(Math.random() * terminals.length)];
}

function displayFlightStatus(flightStatus) {
  const flightStatusDiv = document.getElementById('flight-status');
  
  // Determine status class
  let statusClass = "on-time";
  if (flightStatus.status === "Delayed" || flightStatus.status === "Cancelled") {
    statusClass = "delayed";
  } else if (flightStatus.status === "Boarding" || flightStatus.status === "In Air") {
    statusClass = "boarding";
  } else if (flightStatus.status === "Landed") {
    statusClass = "landed";
  }
  
  // Format dates for display
  const departureTime = new Date(flightStatus.scheduledDeparture);
  const formattedDepartureTime = departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const estimatedDepartureTime = new Date(flightStatus.estimatedDeparture);
  const formattedEstimatedDepartureTime = estimatedDepartureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const estimatedArrivalTime = new Date(flightStatus.estimatedArrival);
  const formattedEstimatedArrivalTime = estimatedArrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Create HTML for the flight status card
  flightStatusDiv.innerHTML = `
    <div class="status-card ${statusClass}">
      <div class="status-header">
        <h3>Flight Status</h3>
        <span class="status-badge ${statusClass}">${flightStatus.status}</span>
      </div>
      
      <div class="status-details">
        <div class="status-item">
          <div class="label">Flight</div>
          <div class="value">${flightStatus.flightNumber}</div>
        </div>
        
        <div class="status-item">
          <div class="label">Scheduled Departure</div>
          <div class="value">${formattedDepartureTime}</div>
        </div>
        
        <div class="status-item">
          <div class="label">Estimated Departure</div>
          <div class="value">${formattedEstimatedDepartureTime}</div>
        </div>
        
        <div class="status-item">
          <div class="label">Departure Gate</div>
          <div class="value">${flightStatus.departureGate || 'TBA'}</div>
        </div>
        
        <div class="status-item">
          <div class="label">Departure Terminal</div>
          <div class="value">${flightStatus.departureTerminal || 'TBA'}</div>
        </div>
        
        <div class="status-item">
          <div class="label">Estimated Arrival</div>
          <div class="value">${formattedEstimatedArrivalTime}</div>
        </div>
        
        <div class="status-item">
          <div class="label">Arrival Gate</div>
          <div class="value">${flightStatus.arrivalGate || 'TBA'}</div>
        </div>
        
        <div class="status-item">
          <div class="label">Arrival Terminal</div>
          <div class="value">${flightStatus.arrivalTerminal || 'TBA'}</div>
        </div>
      </div>
      
      <div class="status-note">
        <p>Note: Flight information is subject to change. Always verify with your airline.</p>
      </div>
      
      <div class="status-actions">
        <button id="refresh-status" class="btn btn-primary">Refresh Status</button>
      </div>
    </div>
  `;
  
  // Add event listener to the refresh button
  document.getElementById('refresh-status').addEventListener('click', () => {
    const airline = document.getElementById('airline').textContent;
    const flightNumber = document.getElementById('flight-number').textContent.split(' ')[1];
    const date = document.getElementById('date').textContent;
    
    fetchFlightStatus(airline, flightNumber, date);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const statusIndicator = document.getElementById('status-indicator');
  const statusMessage = document.getElementById('status-message');
  const cameraContainer = document.getElementById('camera-container');
  const videoElement = document.getElementById('video');
  const manualInputContainer = document.getElementById('manual-input-container');
  const manualBarcodeData = document.getElementById('manual-barcode-data');
  const resultContainer = document.getElementById('result-container');
  const rawDataElement = document.getElementById('raw-data');
  const fieldBreakdownElement = document.getElementById('field-breakdown');
  const startScanButton = document.getElementById('start-scan');
  const closeCameraButton = document.getElementById('close-camera');
  const toggleFlashButton = document.getElementById('toggle-flash');
  const submitManualButton = document.getElementById('submit-manual');
  const cancelManualButton = document.getElementById('cancel-manual');
  const showManualInputButton = document.getElementById('show-manual-input');
  const scanAgainButton = document.getElementById('scan-again');
  const errorModal = document.getElementById('error-modal');
  const errorMessage = document.getElementById('error-message');
  const closeErrorButton = document.getElementById('close-error');
  const toggleDebugButton = document.getElementById('toggle-debug');
  const debugContent = document.getElementById('debug-content');
  const actionButtonContainer = document.getElementById('action-button-container');
  
  // PWA Install Prompt elements
  const installPrompt = document.getElementById('install-prompt');
  const closeInstallPromptButton = document.getElementById('close-install-prompt');
  const installButton = document.getElementById('install-button');
  const installInstructions = document.getElementById('install-instructions');
  
  // State variables
  let scanning = false;
  let stream = null;
  let codeReader = null;
  let hasFlash = false;
  let flashEnabled = false;
  let deferredPrompt = null;
  let isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window.MSStream);
  
  // Initialize the app
  function init() {
    setupEventListeners();
    setupInstallPrompt();
    initBarcodeReader();
  }
  
  // Setup event listeners for UI interactions
  function setupEventListeners() {
    startScanButton.addEventListener('click', startScan);
    closeCameraButton.addEventListener('click', stopScan);
    toggleFlashButton.addEventListener('click', toggleFlash);
    showManualInputButton.addEventListener('click', showManualInput);
    submitManualButton.addEventListener('click', handleManualSubmit);
    cancelManualButton.addEventListener('click', hideManualInput);
    scanAgainButton.addEventListener('click', resetScanner);
    closeErrorButton.addEventListener('click', hideErrorModal);
    toggleDebugButton.addEventListener('click', toggleDebugSection);
  }
  
  // Initialize the barcode reader
  function initBarcodeReader() {
    try {
      // Use ZXing library
      codeReader = new ZXing.BrowserMultiFormatReader();
      console.log('Barcode reader initialized');
    } catch (error) {
      console.error('Error initializing barcode reader:', error);
      showError('Failed to initialize barcode scanner. Please try again or enter data manually.');
    }
  }
  
  // Start the camera and scan for barcodes
  async function startScan() {
    if (scanning) return;
    
    scanning = true;
    updateStatus('Starting camera...', 'pending');
    
    try {
      // Request high-resolution video for better barcode detection
      const constraints = { 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };
      
      console.log('Requesting media with constraints:', constraints);
      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Media stream obtained:', mediaStream.getVideoTracks()[0].getSettings());
      
      stream = mediaStream;
      videoElement.srcObject = mediaStream;
      
      // Show camera view
      cameraContainer.classList.remove('hidden');
      actionButtonContainer.classList.add('hidden');
      
      // Check if torch/flash is available
      const videoTrack = mediaStream.getVideoTracks()[0];
      const capabilities = videoTrack.getCapabilities();
      
      if ('torch' in capabilities) {
        hasFlash = true;
        toggleFlashButton.classList.remove('hidden');
      }
      
      updateStatus('Camera active. Position barcode in the frame.', 'scanning');
      
      // Wait a bit to ensure camera is fully initialized
      setTimeout(() => {
        if (videoElement) {
          console.log('Video element dimensions:', videoElement.videoWidth, 'x', videoElement.videoHeight);
          try {
            // Start continuous scanning
            console.log('Starting barcode scanning...');
            codeReader.decodeFromStream(
              mediaStream,
              videoElement,
              (result, error) => {
                if (result) {
                  console.log('Barcode detected:', result.getText());
                  processScannedData(result.getText());
                }
                if (error && !(error instanceof TypeError)) {
                  console.error('Scan error:', error);
                }
              }
            );
          } catch (error) {
            console.error('Decode error:', error);
            showError(`Error decoding barcode: ${error.message}`);
            stopScan();
          }
        } else {
          console.error('Video element not found');
          showError('Error: Video element not found');
          stopScan();
        }
      }, 1000); // 1 second delay to ensure camera is ready
    } catch (error) {
      scanning = false;
      showError(`Unable to access camera: ${error.message}`);
      console.error('Error accessing camera:', error);
      updateStatus('Camera access failed. Please check permissions.', 'error');
    }
  }
  
  // Process the scanned barcode data
  function processScannedData(data) {
    updateStatus('Scan successful! Processing data...', 'success');
    
    try {
      // Parse BCBP format
      const parsedData = parseBCBP(data);
      
      // Display the parsed data
      displayFlightData(parsedData, data);
      
      // Update status with more specific information
      updateStatus(`Successfully parsed boarding pass for ${parsedData.airline} ${parsedData.flightNumber}`, 'success');
      
      // Fetch flight status for the parsed flight
      fetchFlightStatus(parsedData.airline, parsedData.flightNumber, parsedData.date);
    } catch (error) {
      console.error('Parsing error:', error);
      
      // Provide more descriptive error messages based on common issues
      let errorMsg = error.message;
      
      // Handle specific known error cases
      if (errorMsg.includes('too short')) {
        errorMsg = "The scanned barcode doesn't contain enough data to be a valid boarding pass.";
      } else if (errorMsg.includes('format')) {
        errorMsg = "The scanned barcode doesn't appear to be a boarding pass format.";
      }
      
      showError(`Error: ${errorMsg}`);
      updateStatus('Failed to parse barcode data. Try scanning again or enter data manually.', 'error');
    }
    
    stopScan();
  }
  
  // Stop the camera scanning
  function stopScan() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    
    // Close the code reader
    if (codeReader) {
      try {
        codeReader.reset();
      } catch (error) {
        console.log('Error closing code reader:', error);
        
        // Fallback: manually stop all video tracks if reset fails
        if (stream) {
          console.log('Using fallback: manually stopping video tracks');
          const videoTracks = stream.getVideoTracks();
          videoTracks.forEach(track => {
            try {
              track.stop();
              console.log('Stopped video track:', track.label);
            } catch (trackError) {
              console.error('Error stopping track:', trackError);
            }
          });
        }
      }
    }
    
    cameraContainer.classList.add('hidden');
    scanning = false;
    flashEnabled = false;
    
    // Show action button if no result is displayed
    if (resultContainer.classList.contains('hidden')) {
      actionButtonContainer.classList.remove('hidden');
      showManualInputButton.parentElement.classList.remove('hidden');
    }
  }
  
  // Toggle the flashlight/torch
  async function toggleFlash() {
    if (!stream || !hasFlash) return;
    
    try {
      const videoTrack = stream.getVideoTracks()[0];
      flashEnabled = !flashEnabled;
      
      await videoTrack.applyConstraints({
        advanced: [{ torch: flashEnabled }]
      });
      
      // Update the button appearance
      if (flashEnabled) {
        toggleFlashButton.innerHTML = '❌💡';
        toggleFlashButton.style.backgroundColor = '#fbbf24';
      } else {
        toggleFlashButton.innerHTML = '💡';
        toggleFlashButton.style.backgroundColor = 'white';
      }
    } catch (error) {
      console.error('Error toggling flash:', error);
    }
  }
  
  // Show the manual input form
  function showManualInput() {
    manualInputContainer.classList.remove('hidden');
    showManualInputButton.parentElement.classList.add('hidden');
    actionButtonContainer.classList.add('hidden');
  }
  
  // Hide the manual input form
  function hideManualInput() {
    manualInputContainer.classList.add('hidden');
    showManualInputButton.parentElement.classList.remove('hidden');
    actionButtonContainer.classList.remove('hidden');
    manualBarcodeData.value = '';
  }
  
  // Handle manual barcode data submission
  function handleManualSubmit() {
    const data = manualBarcodeData.value.trim();
    
    if (!data) {
      showError('Please enter the barcode data.');
      return;
    }
    
    processScannedData(data);
    hideManualInput();
  }
  
  // Reset the scanner to start a new scan
  function resetScanner() {
    // Clear previous results
    resultContainer.classList.add('hidden');
    
    // Reset the status
    updateStatus('Ready to scan. Click the button below to start.', 'ready');
    
    // Show the action button
    actionButtonContainer.classList.remove('hidden');
    showManualInputButton.parentElement.classList.remove('hidden');
  }
  
  // Display the flight data
  function displayFlightData(flightData, rawData) {
    // Update the result container with flight data
    document.getElementById('passenger-name').textContent = flightData.passengerName || '-';
    document.getElementById('origin').textContent = flightData.origin || '-';
    document.getElementById('destination').textContent = flightData.destination || '-';
    document.getElementById('airline').textContent = flightData.airline || '-';
    document.getElementById('flight-number').textContent = `${flightData.airline} ${flightData.flightNumber}` || '-';
    document.getElementById('date').textContent = flightData.date || '-';
    document.getElementById('seat').textContent = flightData.seat || '-';
    document.getElementById('class').textContent = getCabinClassName(flightData.class) || flightData.class || '-';
    document.getElementById('pnr').textContent = flightData.pnr || '-';
    
    // Update checked-in status
    const statusDot = document.getElementById('checked-in-status');
    const statusText = document.getElementById('checked-in-text');
    
    if (flightData.checkedIn) {
      statusDot.classList.add('checked-in');
      statusText.textContent = 'Checked in';
    } else {
      statusDot.classList.remove('checked-in');
      statusText.textContent = 'Not checked in';
    }
    
    // Show flight status section if not already present
    if (!document.getElementById('flight-status')) {
      // Create flight status section
      const flightStatusSection = document.createElement('div');
      flightStatusSection.className = 'flight-status-section';
      flightStatusSection.innerHTML = `
        <h2>Live Flight Information</h2>
        <div id="flight-status" class="flight-status">
          <div class="loading-spinner"></div> Fetching flight status...
        </div>
      `;
      
      // Insert it after flight info and before debug section
      const debugSection = document.querySelector('.debug-section');
      resultContainer.insertBefore(flightStatusSection, debugSection);
    }
    
    // Update debug information
    rawDataElement.textContent = rawData;
    fieldBreakdownElement.textContent = formatDataBreakdown(rawData);
    
    // Show result container, hide action button
    resultContainer.classList.remove('hidden');
    actionButtonContainer.classList.add('hidden');
    showManualInputButton.parentElement.classList.add('hidden');
  }
  
  // Toggle the debug section
  function toggleDebugSection() {
    debugContent.classList.toggle('hidden');
    toggleDebugButton.textContent = debugContent.classList.contains('hidden') ? 'Show Details' : 'Hide Details';
  }
  
  // Show error modal
  function showError(message) {
    errorMessage.textContent = message;
    errorModal.classList.remove('hidden');
  }
  
  // Hide error modal
  function hideErrorModal() {
    errorModal.classList.add('hidden');
  }
  
  // Update the status indicator
  function updateStatus(message, type) {
    statusMessage.textContent = message;
    statusIndicator.className = `status ${type}`;
  }
  
  // Setup the PWA install prompt
  function setupInstallPrompt() {
    // Check if already installed as PWA
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                        (window.navigator.standalone === true) || 
                        document.referrer.includes('android-app://');
    
    if (isStandalone) {
      return; // Already installed, don't show prompt
    }
    
    // Check if user has dismissed the prompt before
    const promptDismissed = localStorage.getItem('installPromptDismissed') === 'true';
    if (promptDismissed) {
      return; // User has dismissed the prompt before
    }
    
    // Handle the beforeinstallprompt event
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Store the event for later use
      deferredPrompt = e;
      // Show the install button
      installPrompt.classList.remove('hidden');
    });
    
    // For iOS, show custom instructions
    if (isIOS) {
      // Show iOS-specific instructions after 3 seconds
      setTimeout(() => {
        installInstructions.textContent = 'Tap the share icon then "Add to Home Screen" to install';
        installButton.classList.add('hidden');
        installPrompt.classList.remove('hidden');
      }, 3000);
    }
    
    // Setup install button click handler
    installButton.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      
      // Show the installation prompt
      deferredPrompt.prompt();
      
      // Wait for the user to respond to the prompt
      const choiceResult = await deferredPrompt.userChoice;
      
      // Reset the deferred prompt variable
      deferredPrompt = null;
      
      // Hide the install prompt regardless of outcome
      installPrompt.classList.add('hidden');
    });
    
    // Setup close button
    closeInstallPromptButton.addEventListener('click', () => {
      installPrompt.classList.add('hidden');
      localStorage.setItem('installPromptDismissed', 'true');
    });
  }
  
  // Initialize the app
  init();
});
