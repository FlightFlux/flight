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