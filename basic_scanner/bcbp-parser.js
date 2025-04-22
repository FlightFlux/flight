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