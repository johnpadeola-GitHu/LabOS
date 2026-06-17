/* ============================================================
   LabOS Instrument Gateway — Protocol Parsers
   src/core/gateway-parsers.js

   Implements two production-grade parsers:

   1. ASTMParser  — ASTM E1381 / E1394 (LIS1-A2 / LIS2-A2)
      The dominant protocol for African lab analyzers. Handles:
      · Frame-level: ENQ/ACK/STX/ETX/EOT/NAK control bytes
      · Checksum validation (modulo-256 sum of chars between STX and ETX)
      · Segment types: H (header), P (patient), O (order), R (result),
        Q (query), C (comment), L (terminator), E (error)
      · Field separator `|`, repeat `\`, component `^`, escape `&`
      · Multi-frame messages (frame sequencing 1–7, wrapping to 0)
      · Vendor-specific extensions (Mindray BC-series, Sysmex XP/KX)

   2. HL7Parser   — HL7 v2.x (2.3 / 2.4 / 2.5 / 2.5.1)
      Used by network-connected chemistry analyzers (Roche Cobas, etc.)
      Handles:
      · MSH (message header) — encoding chars, sender, receiver, timestamp
      · PID (patient ID) — patient identifiers
      · OBR (observation request) — order/accession info
      · OBX (observation result) — individual analyte results
      · NTE (notes) — attached to OBR or OBX
      · Standard delimiters: field `|`, component `^`, repeat `~`,
        escape `\`, sub-component `&`
      · Result status: F=final, P=preliminary, C=corrected, X=cancelled
      · Value types: NM (numeric), ST (string), SN (structured numeric)

   Both parsers output a normalised ParsedResult object that the
   GatewayEngine sample-matching and validation engines consume
   directly — no further transformation required.

   ParsedResult shape:
   {
     protocol:       'ASTM' | 'HL7',
     messageId:      string,
     analyzerName:   string,
     analyzerModel:  string,
     sampleId:       string,        // analyzer's internal sample ID
     barcode:        string | null,
     accession:      string | null,
     patientId:      string | null,
     patientName:    string | null,
     orderDate:      string | null, // ISO
     analytes: [{
       code:   string,   // e.g. 'WBC', 'GLU'
       name:   string,   // from message or empty
       value:  string,   // raw string value
       unit:   string,
       flag:   string,   // N | H | L | HH | LL | A | ''
       status: string,   // 'F' final | 'P' preliminary | 'C' corrected
       refRange: string  // raw ref range string from analyzer
     }],
     errors:   string[], // parse warnings / non-fatal issues
     raw:      string    // original message for the audit log
   }
   ============================================================ */

/* ── ASTM Parser ────────────────────────────────────────────────────────────── */
window.ASTMParser = (function () {

  // Control bytes (used in real serial/TCP framing)
  const ENQ = '\x05';
  const ACK = '\x06';
  const STX = '\x02';
  const ETX = '\x03';
  const EOT = '\x04';
  const NAK = '\x15';
  const CR  = '\r';

  // ── Checksum ──────────────────────────────────────────────────────────────
  // ASTM E1381 §6: sum of ASCII values of all bytes between STX and ETX
  // (exclusive), modulo 256, expressed as two uppercase hex digits.
  function computeChecksum(frameBody) {
    let sum = 0;
    for (let i = 0; i < frameBody.length; i++) {
      sum = (sum + frameBody.charCodeAt(i)) & 0xFF;
    }
    return sum.toString(16).toUpperCase().padStart(2, '0');
  }

  function verifyChecksum(raw) {
    // Frame format: STX <seqno> <data> ETX <cs-hi> <cs-lo> CR LF
    const stx = raw.indexOf(STX);
    const etx = raw.indexOf(ETX, stx);
    if (stx < 0 || etx < 0) return { valid: false, reason: 'Missing STX/ETX framing' };
    const body     = raw.substring(stx + 1, etx);
    const expected = computeChecksum(body);
    const actual   = raw.substring(etx + 1, etx + 3).toUpperCase();
    if (!actual) return { valid: true, reason: 'No checksum present (older device)' };
    return actual === expected
      ? { valid: true,  reason: 'Checksum OK' }
      : { valid: false, reason: `Checksum mismatch: expected ${expected}, got ${actual}` };
  }

  // ── Frame extraction ──────────────────────────────────────────────────────
  // Strip STX/ETX framing and control bytes, reassemble multi-frame messages.
  function extractFrames(raw) {
    const frames = [];
    let pos = 0;
    while (pos < raw.length) {
      const stx = raw.indexOf(STX, pos);
      if (stx < 0) break;
      const etx = raw.indexOf(ETX, stx);
      if (etx < 0) break;
      // Frame body is between STX and ETX; first char is the sequence number
      const body = raw.substring(stx + 1, etx);
      const seq  = body.charAt(0);
      const data = body.substring(1);
      frames.push({ seq: parseInt(seq) || 0, data });
      pos = etx + 1;
    }
    return frames;
  }

  // ── Segment splitting ─────────────────────────────────────────────────────
  // In real ASTM, CR (\r) is the segment terminator.
  // Devices often send bare text without STX/ETX — we handle both.
  function splitSegments(text) {
    // Normalise: replace literal \r or \\r or \n with actual CR
    const normalised = text
      .replace(/\\r/g, '\r')
      .replace(/\\n/g, '\n')
      .replace(/\n/g, '\r');
    return normalised
      .split('\r')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  // ── Field parsing ─────────────────────────────────────────────────────────
  // ASTM uses | as field separator, ^ as component separator.
  function fields(segment)    { return segment.split('|'); }
  function components(field)  { return (field || '').split('^'); }

  // ── Timestamp parsing ─────────────────────────────────────────────────────
  // ASTM timestamps: YYYYMMDDHHMMSS or YYYYMMDD
  function parseTimestamp(ts) {
    if (!ts) return null;
    const s = ts.replace(/[^0-9]/g, '');
    if (s.length >= 14)
      return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}`;
    if (s.length >= 8)
      return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    return null;
  }

  // ── Flag normalisation ────────────────────────────────────────────────────
  // ASTM flags: H (high), L (low), N (normal), blank (normal),
  // Vendors extend: HH, LL, * (critical), + (very high), - (very low)
  function normaliseFlag(raw) {
    if (!raw) return 'N';
    const f = raw.trim().toUpperCase();
    if (f === 'HH' || f === '++' || f === 'PH') return 'HH';
    if (f === 'LL' || f === '--' || f === 'PL') return 'LL';
    if (f === 'H'  || f === '+'  || f === 'A+') return 'H';
    if (f === 'L'  || f === '-'  || f === 'A-') return 'L';
    if (f === 'N'  || f === '' ) return 'N';
    if (f === 'A'  || f === 'AB') return 'A'; // abnormal, unspecified direction
    return f;
  }

  // ── Main parse function ───────────────────────────────────────────────────
  function parse(raw, analyzerMeta) {
    const result = {
      protocol:     'ASTM',
      messageId:    null,
      analyzerName: (analyzerMeta && analyzerMeta.name)  || '',
      analyzerModel:(analyzerMeta && analyzerMeta.model) || '',
      sampleId:     null,
      barcode:      null,
      accession:    null,
      patientId:    null,
      patientName:  null,
      orderDate:    null,
      analytes:     [],
      errors:       [],
      raw
    };

    // Checksum check (best-effort — many field analyzers omit it)
    if (raw.includes(STX)) {
      const cs = verifyChecksum(raw);
      if (!cs.valid) result.errors.push(`Checksum: ${cs.reason}`);
    }

    // Extract segment text — strip framing if present, else parse as-is
    let segText = raw;
    if (raw.includes(STX)) {
      const frames = extractFrames(raw);
      segText = frames.map(f => f.data).join('\r');
    }

    const segments = splitSegments(segText);
    if (segments.length === 0) {
      result.errors.push('No segments found in message');
      return result;
    }

    let currentOrder   = null;
    let orderRecordIdx = 0;

    for (const seg of segments) {
      const f  = fields(seg);
      const id = f[0];

      switch (id) {

        // ── H — Header ──────────────────────────────────────────────────────
        case 'H': {
          // H|\^&||sender|||||||P|1
          // f[5] = sender (analyzer model^vendor)
          const sender = components(f[5] || '');
          if (!result.analyzerModel && sender[0]) result.analyzerModel = sender[0];
          if (!result.analyzerName  && sender[1]) result.analyzerName  = sender[1];
          result.messageId = f[12] || null; // processing ID or timestamp
          break;
        }

        // ── P — Patient ──────────────────────────────────────────────────────
        case 'P': {
          // P|seq|practice_patient_id|lab_patient_id|name_last^name_first|...
          result.patientId   = f[3] || f[2] || null;
          // ASTM P-5 = patient name; vendors often shorten: try f[5], f[4], f[3]
          const nameField = f[5] || f[4] || f[3] || '';
          const nameParts = components(nameField);
          if (nameParts[0] || nameParts[1])
            result.patientName = [nameParts[1], nameParts[0]].filter(Boolean).join(' ');
          break;
        }

        // ── O — Order ────────────────────────────────────────────────────────
        case 'O': {
          // O|seq|sample_id|rack|^^^test_id|priority|order_date|collection_date
          orderRecordIdx++;
          const sampleId  = f[2] || null;
          const rackId    = f[3] || null; // some devices put barcode here
          const testComp  = components(f[4] || '');
          currentOrder = {
            sampleId:  sampleId,
            barcode:   rackId || sampleId,
            accession: f[1]  || null,     // sequence used as accession
            orderDate: parseTimestamp(f[7] || f[8] || null),
            testId:    testComp[3] || testComp[0] || null
          };
          // First O record populates the top-level fields
          if (orderRecordIdx === 1) {
            result.sampleId  = currentOrder.sampleId;
            result.barcode   = currentOrder.barcode;
            result.accession = currentOrder.accession;
            result.orderDate = currentOrder.orderDate;
          }
          break;
        }

        // ── R — Result ───────────────────────────────────────────────────────
        case 'R': {
          // R|seq|^^^test_id|value|units|ref_range|flags|result_status|...
          const testComp  = components(f[2] || '');
          // ASTM universal test ID: empty^empty^empty^code^name^system
          // testComp[3] = test code, testComp[4] = test name
          const code      = testComp[3] || testComp[0] || '??';
          const name      = testComp[4] || testComp[1] || '';
          const value     = f[3] || '';
          const unit      = f[4] || '';
          const refRange  = f[5] || '';
          const rawFlag   = f[6] || '';
          const status    = f[8] || 'F'; // F=final, P=preliminary, C=corrected

          result.analytes.push({
            code:     code.toUpperCase().trim(),
            name:     name.trim(),
            value:    value.trim(),
            unit:     unit.trim(),
            flag:     normaliseFlag(rawFlag),
            status,
            refRange: refRange.trim()
          });
          break;
        }

        // ── E — Error ────────────────────────────────────────────────────────
        case 'E': {
          // E|error_code|error_text
          result.errors.push(`Analyzer error ${f[1] || ''}: ${f[2] || 'Unknown error'}`);
          break;
        }

        // ── C — Comment ──────────────────────────────────────────────────────
        case 'C': {
          // Non-fatal — comments attached to results or orders. Log but continue.
          break;
        }

        // ── L — Terminator ───────────────────────────────────────────────────
        case 'L': {
          // L|1|N — normal termination; L|1|E — abnormal/error termination
          const termCode = f[2] || 'N';
          if (termCode !== 'N') result.errors.push(`Abnormal termination: ${termCode}`);
          break;
        }

        // ── Q — Query (device requesting orders from LIS) ────────────────────
        case 'Q': {
          // Not a result message — for bi-directional interfaces.
          // Flag but don't fail.
          result.errors.push('Received query message (Q) — this is a worklist request, not a result');
          break;
        }

        default:
          // Unknown segment — log and continue
          if (id && id !== '') result.errors.push(`Unknown segment type: ${id}`);
      }
    }

    return result;
  }

  // ── Vendor-specific extensions ────────────────────────────────────────────

  // Mindray BC-series: extra parameters in extended R segments
  // and a proprietary WPC (white cell distribution) channel.
  function parseMindrayBC(raw, analyzerMeta) {
    const base = parse(raw, analyzerMeta);
    // Mindray uses flag codes like '+' for high and '-' for low
    // in addition to standard H/L — already handled by normaliseFlag().
    // Mindray also sends instrument error codes in field 9 of the R record.
    const segments = splitSegments(raw);
    for (const seg of segments) {
      const f = fields(seg);
      if (f[0] === 'R' && f[9]) {
        const instError = f[9].trim();
        if (instError && instError !== '0' && instError !== '')
          base.errors.push(`Mindray instrument error code ${instError} on ${f[2] || 'unknown parameter'}`);
      }
    }
    return base;
  }

  // Sysmex XP-300 / KX-21: 3-part differential only, baud rate 2400.
  // Uses modified field ordering — sample ID is in field 2 of the H record.
  function parseSysmex(raw, analyzerMeta) {
    const base = parse(raw, analyzerMeta);
    // Sysmex outputs WBC, RBC, HGB, HCT, MCV, MCH, MCHC, PLT plus
    // 3-part diff (LYM%, MON%, GRA%). All handled by generic parse().
    // Sysmex sends 'R' flag for reactive lymphocytes — map to 'A'.
    base.analytes = base.analytes.map(a => ({
      ...a,
      flag: a.flag === 'R' ? 'A' : a.flag
    }));
    return base;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    // Core parser — use for Generic ASTM Driver
    parse,
    // Vendor parsers — delegates to parse() with extra processing
    parseMindrayBC,
    parseSysmex,
    // Utilities — exposed so the Gateway agent can use them
    computeChecksum,
    verifyChecksum,
    extractFrames,
    splitSegments,
    normaliseFlag,
    // Control byte constants — useful for implementing the serial driver
    CTRL: { ENQ, ACK, STX, ETX, EOT, NAK, CR }
  };
})();


/* ── HL7 v2.x Parser ────────────────────────────────────────────────────────── */
window.HL7Parser = (function () {

  // ── Delimiter extraction ──────────────────────────────────────────────────
  // MSH segment always starts with MSH| and the next 4 chars define delimiters.
  // Standard: MSH|^~\& — field=|, component=^, repeat=~, escape=\, subcomp=&
  function extractDelimiters(msh) {
    if (!msh || !msh.startsWith('MSH')) {
      return { field: '|', component: '^', repeat: '~', escape: '\\', subComponent: '&' };
    }
    const field     = msh.charAt(3) || '|';
    const component = msh.charAt(4) || '^';
    const repeat    = msh.charAt(5) || '~';
    const escape    = msh.charAt(6) || '\\';
    const subComp   = msh.charAt(7) || '&';
    return { field, component, repeat, escape, subComponent: subComp };
  }

  // ── Segment splitting ─────────────────────────────────────────────────────
  // HL7 v2 uses CR (\r) as segment terminator. Some systems send \n or \r\n.
  function splitSegments(text) {
    return text
      .replace(/\\r/g, '\r')
      .replace(/\\n/g, '\n')
      .replace(/\r\n/g, '\r')
      .replace(/\n/g, '\r')
      .split('\r')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  // ── Field helpers ─────────────────────────────────────────────────────────
  function fields(segment, delim)      { return segment.split(delim.field); }
  function components(field, delim)    { return (field || '').split(delim.component); }
  function repeats(field, delim)       { return (field || '').split(delim.repeat); }

  // ── Timestamp parsing ─────────────────────────────────────────────────────
  // HL7 timestamps: YYYYMMDDHHMMSS[.SSSS][+/-ZZZZ]
  function parseTimestamp(ts) {
    if (!ts) return null;
    const s = ts.replace(/[^0-9]/g, '');
    if (s.length >= 14)
      return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}`;
    if (s.length >= 8)
      return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    return null;
  }

  // ── Flag normalisation ────────────────────────────────────────────────────
  // HL7 OBX-8 (Abnormal flags):
  //   L=below low normal, H=above high normal, LL=below panic low,
  //   HH=above panic high, < =below absolute low, > =above absolute high,
  //   N=normal, A=abnormal (unspecified), AA=very abnormal,
  //   U=significantly up, D=significantly down (delta flags),
  //   B=better, W=worse (clinical interpretation)
  function normaliseFlag(raw) {
    if (!raw) return 'N';
    const f = raw.trim().toUpperCase();
    if (f === 'HH' || f === 'AA' || f === '>' ) return 'HH';
    if (f === 'LL' || f === '<'               ) return 'LL';
    if (f === 'H'  || f === 'U'               ) return 'H';
    if (f === 'L'  || f === 'D'               ) return 'L';
    if (f === 'A'  || f === 'B' || f === 'W'  ) return 'A';
    if (f === 'N'  || f === ''                ) return 'N';
    return f;
  }

  // ── CX data type (patient identifiers) ───────────────────────────────────
  // PID-3: CX = ID^check^assigning^facility^...
  // We want the first ID and optionally the assigning authority.
  function extractPatientId(pid3Field, delim) {
    const reps = repeats(pid3Field, delim);
    for (const rep of reps) {
      const parts = components(rep, delim);
      if (parts[0]) return parts[0];
    }
    return null;
  }

  // ── XPN data type (person names) ─────────────────────────────────────────
  // PID-5: XPN = family^given^middle^suffix^prefix
  function extractPersonName(xpn, delim) {
    const parts = components(xpn, delim);
    return [parts[1], parts[0]].filter(Boolean).join(' ') || null;
  }

  // ── OBX value parsing ─────────────────────────────────────────────────────
  // OBX-2 = value type: NM (numeric), ST (string), SN (structured numeric)
  // OBX-3 = observation identifier (CE): code^text^coding_system
  // OBX-5 = observation value
  // OBX-6 = units (CE): code^text
  // OBX-7 = reference range (string)
  // OBX-8 = abnormal flags (IS, repeating)
  // OBX-11 = observation result status: F/P/C/X/R/I
  function parseOBX(seg, delim) {
    const f        = fields(seg, delim);
    const valueType = f[2] || 'ST';
    const obsId     = components(f[3] || '', delim);
    const code      = obsId[0] || '';
    const name      = obsId[1] || '';
    const rawValue  = f[5]  || '';
    const units     = components(f[6] || '', delim);
    const refRange  = f[7]  || '';
    const rawFlags  = f[8]  || '';
    const status    = f[11] || 'F';

    // Parse SN (structured numeric): operator + value e.g. ">10", "<=5", "5^10"
    let value = rawValue;
    if (valueType === 'SN') {
      const parts = components(rawValue, delim);
      value = parts.join('');  // operator + number e.g. '>5'
    }

    // Flags can repeat: HH~L → take the most severe
    const flagList = repeats(rawFlags, delim).map(normaliseFlag);
    const flagPriority = ['HH','LL','H','L','A','N'];
    const flag = flagList.reduce((best, curr) =>
      flagPriority.indexOf(curr) < flagPriority.indexOf(best) ? curr : best,
      'N');

    return {
      code:     code.toUpperCase().trim(),
      name:     name.trim(),
      value:    value.trim(),
      unit:     (units[1] || units[0] || '').trim(),
      flag,
      status:   status.trim(),
      refRange: refRange.trim()
    };
  }

  // ── Main parse function ───────────────────────────────────────────────────
  function parse(raw, analyzerMeta) {
    const result = {
      protocol:     'HL7',
      messageId:    null,
      analyzerName: (analyzerMeta && analyzerMeta.name)  || '',
      analyzerModel:(analyzerMeta && analyzerMeta.model) || '',
      sampleId:     null,
      barcode:      null,
      accession:    null,
      patientId:    null,
      patientName:  null,
      orderDate:    null,
      analytes:     [],
      errors:       [],
      raw
    };

    const segments = splitSegments(raw);
    if (segments.length === 0) {
      result.errors.push('No segments found in message');
      return result;
    }

    // Extract delimiters from MSH
    const mshSeg = segments.find(s => s.startsWith('MSH'));
    if (!mshSeg) {
      result.errors.push('No MSH segment — invalid HL7 message');
      return result;
    }

    const delim = extractDelimiters(mshSeg);
    const f     = fields(mshSeg, delim);

    // MSH-3  = sending application (analyzer model)
    // MSH-4  = sending facility
    // MSH-9  = message type (should be ORU^R01 for results)
    // MSH-10 = message control ID
    // MSH-12 = version ID
    const sendingApp = f[3] || '';
    // HL7 array index = field number - 1
    // MSH-8=f[8]=msg-type, MSH-9=f[9]=msg-ctrl-id, MSH-11=f[11]=version
    const msgType    = components(f[8]  || '', delim);
    const msgCtrlId  = f[9]  || '';
    const version    = f[11] || '';

    if (!result.analyzerModel && sendingApp) result.analyzerModel = sendingApp;
    result.messageId = msgCtrlId || null;

    // Validate message type
    if (msgType[0] !== 'ORU' && msgType[0] !== '') {
      result.errors.push(`Unexpected message type ${msgType[0]}^${msgType[1]} — expected ORU^R01`);
    }

    let currentOBR = null;

    for (const seg of segments) {
      const segId = seg.substring(0, 3);

      switch (segId) {

        // ── PID — Patient Identification ────────────────────────────────────
        case 'PID': {
          const pf = fields(seg, delim);
          // PID-3: patient identifier list (CX)
          result.patientId   = extractPatientId(pf[3] || pf[4] || '', delim) || null;
          // PID-5: patient name (XPN)
          result.patientName = extractPersonName(pf[5] || '', delim);
          break;
        }

        // ── OBR — Observation Request ────────────────────────────────────────
        case 'OBR': {
          const bf = fields(seg, delim);
          // OBR-2: placer order number (order ID from LIS side)
          // OBR-3: filler order number (accession from analyzer)
          // OBR-4: universal service identifier (panel ordered)
          // OBR-7: observation date/time
          currentOBR = {
            placerOrderNum: bf[2] || null,
            fillerOrderNum: bf[3] || null,
            serviceId:      components(bf[4] || '', delim)[0] || null,
            observationDate: parseTimestamp(bf[7] || null)
          };
          // Populate accession from OBR-3 if not set
          if (!result.accession) result.accession = currentOBR.fillerOrderNum;
          if (!result.sampleId)  result.sampleId  = currentOBR.fillerOrderNum || currentOBR.placerOrderNum;
          if (!result.orderDate) result.orderDate  = currentOBR.observationDate;
          break;
        }

        // ── OBX — Observation Result ─────────────────────────────────────────
        case 'OBX': {
          const analyte = parseOBX(seg, delim);
          if (analyte.code) {
            result.analytes.push(analyte);
          } else {
            result.errors.push(`OBX with empty observation code skipped`);
          }
          break;
        }

        // ── NTE — Notes ──────────────────────────────────────────────────────
        case 'NTE': {
          // Attach as comment — not a result
          break;
        }

        // ── MSA — Message Acknowledgement ────────────────────────────────────
        case 'MSA': {
          // Only present in ACK messages, not ORU
          break;
        }

        // ── ERR — Error Segment ───────────────────────────────────────────────
        case 'ERR': {
          const ef = fields(seg, delim);
          result.errors.push(`HL7 error: ${ef[3] || ef[1] || 'Unknown'}`);
          break;
        }

        case 'MSH': break; // already processed
        case 'EVN': break; // event type — not needed for results
        case 'PV1': break; // patient visit — not needed for results

        default:
          if (segId && segId.trim()) result.errors.push(`Unhandled segment: ${segId}`);
      }
    }

    return result;
  }

  // ── Roche Cobas extension ─────────────────────────────────────────────────
  // Cobas c-series uses standard HL7 2.5 with a few extensions:
  // · ZDS segment (Cobas-specific device status) — ignore safely
  // · LONIC codes in OBX-3.3 for coding system
  // · Units sometimes expressed as UCUM codes
  function parseRocheCobas(raw, analyzerMeta) {
    const base = parse(raw, analyzerMeta);
    // Strip ZDS segments from errors (they're benign Cobas-specific extensions)
    base.errors = base.errors.filter(e => !e.includes('ZDS') && !e.includes('ZPC'));
    return base;
  }

  // ── Generate ACK message ──────────────────────────────────────────────────
  // HL7 requires an ACK (acknowledgement) message to be sent back to the
  // analyzer after receiving an ORU. This confirms receipt.
  // AA = Application Accept, AE = Application Error, AR = Application Reject
  function generateACK(originalMSH, ackCode, errorMsg) {
    const delim    = extractDelimiters(originalMSH);
    const f        = fields(originalMSH, delim);
    const now      = new Date().toISOString().replace(/[-:.T]/g,'').slice(0,14);
    // Corrected indices (array index = HL7 field number - 1):
    // f[2]=sending app, f[3]=sending facility, f[4]=receiving app, f[5]=receiving facility
    // f[9]=message control ID, f[11]=version ID
    const sendingApp  = f[2] || 'ANALYZER';
    const sendingFac  = f[3] || '';
    const receivingApp = f[4] || 'LABOS';
    const msgCtrl  = f[9]  || '';
    const version  = f[11] || '2.5';
    const ack  = [
      `MSH${delim.field}${delim.component}${delim.repeat}${delim.escape}${delim.subComponent}${delim.field}LABOS${delim.field}LAB${delim.field}${sendingApp}${delim.field}${sendingFac}${delim.field}${now}${delim.field}${delim.field}ACK^R01${delim.field}ACK${now}${delim.field}P${delim.field}${version}`,
      `MSA${delim.field}${ackCode || 'AA'}${delim.field}${msgCtrl}${delim.field}${errorMsg || ''}`,
    ].join('\r') + '\r';
    return ack;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    // Core parser — use for Generic HL7 Driver
    parse,
    // Vendor parser
    parseRocheCobas,
    // Utilities
    extractDelimiters,
    splitSegments,
    parseOBX,
    normaliseFlag,
    generateACK
  };
})();


/* ── Unified GatewayProtocol dispatcher ─────────────────────────────────────── */
// Wraps both parsers behind a single interface. Automatically routes
// to the correct parser based on the analyzer's driver key.
window.GatewayProtocol = (function () {

  function detect(raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('MSH|') || trimmed.includes('\rMSH|')) return 'HL7';
    if (trimmed.startsWith('H|')   || trimmed.includes('\rH|'))   return 'ASTM';
    // Try to detect framed ASTM (STX present)
    if (trimmed.includes('\x02') || trimmed.includes('\x03'))     return 'ASTM';
    return 'UNKNOWN';
  }

  function parseAuto(raw, analyzerConfig) {
    const protocol = detect(raw);
    return parseWith(raw, analyzerConfig, protocol);
  }

  function parseWith(raw, analyzerConfig, protocol) {
    const meta = analyzerConfig || {};
    const driver = (meta.driver || '').toLowerCase();

    if (protocol === 'HL7' || driver.includes('hl7') || driver === 'roche_cobas') {
      const parser = driver === 'roche_cobas'
        ? window.HL7Parser.parseRocheCobas
        : window.HL7Parser.parse;
      return parser(raw, meta);
    }

    if (protocol === 'ASTM' ||
        driver.startsWith('mindray') ||
        driver.startsWith('sysmex') ||
        driver.startsWith('generic_astm')) {
      const parser = driver.startsWith('mindray')
        ? window.ASTMParser.parseMindrayBC
        : driver.startsWith('sysmex')
        ? window.ASTMParser.parseSysmex
        : window.ASTMParser.parse;
      return parser(raw, meta);
    }

    // Unknown protocol — return error result
    return {
      protocol: 'UNKNOWN', messageId: null,
      analyzerName: meta.name || '', analyzerModel: meta.model || '',
      sampleId: null, barcode: null, accession: null,
      patientId: null, patientName: null, orderDate: null,
      analytes: [],
      errors: [`Cannot parse protocol: ${protocol}. Raw: ${raw.substring(0,80)}`],
      raw
    };
  }

  // Integration point: takes a ParsedResult and pushes it into
  // GATEWAY_STATE so the matching/validation pipeline can pick it up.
  function ingest(parsedResult, analyzerId) {
    if (!parsedResult || parsedResult.errors.length > 0 && parsedResult.analytes.length === 0) return;
    const gs = window.GATEWAY_STATE;
    if (!gs) return;

    // Create a gateway message log entry
    const msgId = 'MSG-' + Date.now();
    gs.gatewayMessages = gs.gatewayMessages || [];
    gs.gatewayMessages.unshift({
      id:          msgId,
      analyzerId:  analyzerId || null,
      direction:   'IN',
      protocol:    parsedResult.protocol,
      messageType: parsedResult.protocol === 'HL7' ? 'ORU^R01' : 'OBX',
      rawData:     parsedResult.raw.substring(0, 500),
      parsed:      parsedResult.analytes.length > 0,
      parseError:  parsedResult.errors.length > 0 ? parsedResult.errors[0] : null,
      receivedAt:  new Date().toISOString()
    });

    // If we got analytes, create a gateway result entry
    if (parsedResult.analytes.length > 0) {
      const grId = 'GR-' + Date.now();
      gs.gatewayResults = gs.gatewayResults || [];
      gs.gatewayResults.unshift({
        id:                 grId,
        analyzerId:         analyzerId || null,
        analyzerSampleId:   parsedResult.sampleId,
        analyzerBarcode:    parsedResult.barcode,
        analyzerAccession:  parsedResult.accession,
        analyzerPatientId:  parsedResult.patientId,
        matchedPatientId:   null,
        matchedRequestId:   null,
        matchMethod:        null,
        matchConfidence:    null,
        status:             'pending',
        receivedAt:         new Date().toISOString(),
        analytes:           parsedResult.analytes.map(a => ({
          ...a,
          status: a.flag === 'HH' || a.flag === 'LL' ? 'critical'
                : a.flag === 'H'  || a.flag === 'L'  ? 'abnormal'
                : 'normal'
        }))
      });

      // Update the analyzer's last-result timestamp and result count
      const analyzer = (gs.analyzers || []).find(a => a.id === analyzerId);
      if (analyzer) {
        analyzer.lastResultAt = new Date().toISOString();
        analyzer.resultCount  = (analyzer.resultCount || 0) + 1;
        if (parsedResult.errors.length > 0) {
          analyzer.errorCount = (analyzer.errorCount || 0) + 1;
        }
      }
    }
  }

  // Test/demo function: parse a raw message and display the result
  function testParse(raw, analyzerConfig) {
    const result = parseAuto(raw, analyzerConfig);
    console.log('[GatewayProtocol] Parsed result:', result);
    return result;
  }

  return { detect, parseAuto, parseWith, ingest, testParse };
})();
