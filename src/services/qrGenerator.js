// src/services/qrGenerator.js
// Generates QR code images with amount pre-filled for KG bank payments

var QRCode = require('qrcode');

function crc16(str) {
  var crc = 0xFFFF;
  for (var i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (var j = 0; j < 8; j++) {
      if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
      else crc = crc << 1;
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

function parseTLV(data) {
  var tags = [];
  var pos = 0;
  while (pos + 4 <= data.length) {
    var tag = data.substring(pos, pos + 2);
    var lenStr = data.substring(pos + 2, pos + 4);
    var len = parseInt(lenStr);
    if (isNaN(len) || len < 0) break;
    if (pos + 4 + len > data.length) break;
    var val = data.substring(pos + 4, pos + 4 + len);
    tags.push({ tag: tag, len: len, val: val });
    pos += 4 + len;
  }
  return tags;
}

function buildTLV(tag, value) {
  return tag + String(value.length).padStart(2, '0') + value;
}

function injectAmount(qrData, amount) {
  var amtStr = parseFloat(amount).toFixed(2);

  // Parse all tags from original QR
  var tags = parseTLV(qrData);

  // Rebuild: remove old amount (54) and old CRC (63), insert new amount
  var output = '';
  var amountInserted = false;

  for (var i = 0; i < tags.length; i++) {
    var t = tags[i];

    // Skip old amount and old CRC
    if (t.tag === '54') continue;
    if (t.tag === '63') continue;

    // Insert new amount before tags 52, 53, 58, or 59
    if (!amountInserted && (t.tag === '52' || t.tag === '53' || t.tag === '58' || t.tag === '59')) {
      output += buildTLV('54', amtStr);
      amountInserted = true;
    }

    output += buildTLV(t.tag, t.val);
  }

  // If amount not inserted yet, add it now
  if (!amountInserted) {
    output += buildTLV('54', amtStr);
  }

  // Add CRC placeholder and calculate correct checksum
  output += '6304';
  output += crc16(output);

  return output;
}

async function generateQR(qrData, amount) {
  var qrWithAmount = injectAmount(qrData, amount);

  var buffer = await QRCode.toBuffer(qrWithAmount, {
    type: 'png',
    width: 400,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
    errorCorrectionLevel: 'M',
  });

  return { buffer: buffer, qrString: qrWithAmount };
}

module.exports = {
  generateQR: generateQR,
  injectAmount: injectAmount,
  crc16: crc16,
};