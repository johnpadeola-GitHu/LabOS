/* ============================================================
   LabOS Instrument Gateway — Core Engine
   src/core/instrument-gateway.js

   Provides:
   - GATEWAY_STATE  : in-memory store (seeded for demo)
   - ANALYZER_DRIVERS : driver registry + capabilities
   - GatewayEngine  : sample matching + result validation logic
   ============================================================ */

// ── Seed data ─────────────────────────────────────────────────────────────────
window.GATEWAY_STATE = {
  analyzers: [
    {
      id:'ANA-001', name:'Mindray BC-5000 (Hematology)', vendor:'Mindray', model:'BC-5000',
      department:'Hematology', protocol:'ASTM', driver:'mindray_bc5000',
      serialNumber:'BC5K-2024-0042', status:'online', lastSeen: new Date(Date.now()-45000).toISOString(),
      lastResultAt: new Date(Date.now()-120000).toISOString(), resultCount:847, errorCount:2,
      notes:'Primary hematology analyzer. Calibrated monthly.', active:true,
      port:{ type:'TCP', ip:'192.168.1.101', port:5000 }
    },
    {
      id:'ANA-002', name:'Sysmex XP-300 (Backup Hematology)', vendor:'Sysmex', model:'XP-300',
      department:'Hematology', protocol:'ASTM', driver:'sysmex_xp300',
      serialNumber:'XP3-2023-9981', status:'offline', lastSeen: new Date(Date.now()-3600000).toISOString(),
      lastResultAt: new Date(Date.now()-7200000).toISOString(), resultCount:1243, errorCount:7,
      notes:'Backup analyzer. Offline for scheduled maintenance.', active:true,
      port:{ type:'RS232', comPort:'COM3', baudRate:9600, dataBits:8, stopBits:'1', parity:'None' }
    },
    {
      id:'ANA-003', name:'Roche Cobas c311 (Chemistry)', vendor:'Roche', model:'Cobas c311',
      department:'Clinical Chemistry', protocol:'HL7', driver:'roche_cobas',
      serialNumber:'C311-2022-5523', status:'online', lastSeen: new Date(Date.now()-12000).toISOString(),
      lastResultAt: new Date(Date.now()-300000).toISOString(), resultCount:3210, errorCount:0,
      notes:'Main chemistry analyzer. HL7 v2.5 interface.', active:true,
      port:{ type:'TCP', ip:'192.168.1.105', port:6661 }
    },
    {
      id:'ANA-004', name:'Sysmex KX-21 (Satellite Lab)', vendor:'Sysmex', model:'KX-21',
      department:'Hematology', protocol:'ASTM', driver:'sysmex_kx21',
      serialNumber:'KX21-2019-3312', status:'error', lastSeen: new Date(Date.now()-900000).toISOString(),
      lastResultAt: new Date(Date.now()-900000).toISOString(), resultCount:5678, errorCount:34,
      notes:'Satellite lab unit. Serial connection via RS-232.', active:true,
      port:{ type:'RS232', comPort:'COM7', baudRate:2400, dataBits:8, stopBits:'1', parity:'Even' }
    }
  ],

  testMappings: [
    // Hematology — shared across Mindray BC-5000, Sysmex XP-300, Sysmex KX-21
    { id:'TM-001', analyzerCode:'WBC', labosCode:'WBC',  labosName:'White Blood Cell Count',   unit:'×10⁹/L', refLowM:4.0, refHighM:11.0,  refLowF:4.0, refHighF:11.0,  critLow:2.0, critHigh:30.0,  decimalPlaces:2, analyzerIds:['ANA-001','ANA-002','ANA-004'] },
    { id:'TM-002', analyzerCode:'RBC', labosCode:'RBC',  labosName:'Red Blood Cell Count',     unit:'×10¹²/L',refLowM:4.5, refHighM:5.9,   refLowF:3.8, refHighF:5.2,   critLow:2.0, critHigh:7.0,   decimalPlaces:2, analyzerIds:['ANA-001','ANA-002','ANA-004'] },
    { id:'TM-003', analyzerCode:'HGB', labosCode:'HGB',  labosName:'Hemoglobin',               unit:'g/dL',   refLowM:13.5,refHighM:17.5,  refLowF:12.0,refHighF:16.0,  critLow:7.0, critHigh:20.0,  decimalPlaces:1, analyzerIds:['ANA-001','ANA-002','ANA-004'] },
    { id:'TM-004', analyzerCode:'HCT', labosCode:'HCT',  labosName:'Hematocrit',               unit:'%',      refLowM:41,  refHighM:53,    refLowF:36,  refHighF:46,    critLow:20,  critHigh:60,    decimalPlaces:1, analyzerIds:['ANA-001','ANA-002','ANA-004'] },
    { id:'TM-005', analyzerCode:'MCV', labosCode:'MCV',  labosName:'Mean Corpuscular Volume',  unit:'fL',     refLowM:80,  refHighM:100,   refLowF:80,  refHighF:100,   critLow:60,  critHigh:125,   decimalPlaces:1, analyzerIds:['ANA-001','ANA-002','ANA-004'] },
    { id:'TM-006', analyzerCode:'MCH', labosCode:'MCH',  labosName:'Mean Corpuscular Hemoglobin', unit:'pg',  refLowM:27,  refHighM:33,    refLowF:27,  refHighF:33,    critLow:null,critHigh:null,  decimalPlaces:1, analyzerIds:['ANA-001','ANA-002','ANA-004'] },
    { id:'TM-007', analyzerCode:'MCHC',labosCode:'MCHC', labosName:'MCH Concentration',       unit:'g/dL',   refLowM:32,  refHighM:36,    refLowF:32,  refHighF:36,    critLow:null,critHigh:null,  decimalPlaces:1, analyzerIds:['ANA-001','ANA-002','ANA-004'] },
    { id:'TM-008', analyzerCode:'PLT', labosCode:'PLT',  labosName:'Platelet Count',           unit:'×10⁹/L', refLowM:150, refHighM:400,   refLowF:150, refHighF:400,   critLow:50,  critHigh:1000,  decimalPlaces:0, analyzerIds:['ANA-001','ANA-002','ANA-004'] },
    { id:'TM-009', analyzerCode:'NEU#',labosCode:'NEUT', labosName:'Neutrophils (Absolute)',   unit:'×10⁹/L', refLowM:1.8, refHighM:7.5,   refLowF:1.8, refHighF:7.5,   critLow:0.5, critHigh:null,  decimalPlaces:2, analyzerIds:['ANA-001'] },
    { id:'TM-010', analyzerCode:'LYM#',labosCode:'LYMPH',labosName:'Lymphocytes (Absolute)',   unit:'×10⁹/L', refLowM:1.0, refHighM:4.0,   refLowF:1.0, refHighF:4.0,   critLow:null,critHigh:null,  decimalPlaces:2, analyzerIds:['ANA-001'] },
    { id:'TM-011', analyzerCode:'MON#',labosCode:'MONO', labosName:'Monocytes (Absolute)',     unit:'×10⁹/L', refLowM:0.2, refHighM:1.0,   refLowF:0.2, refHighF:1.0,   critLow:null,critHigh:null,  decimalPlaces:2, analyzerIds:['ANA-001'] },
    // Chemistry — Roche Cobas c311
    { id:'TM-012', analyzerCode:'GLU', labosCode:'GLUC', labosName:'Glucose',                  unit:'mmol/L', refLowM:3.9, refHighM:6.1,   refLowF:3.9, refHighF:6.1,   critLow:2.8, critHigh:22.2,  decimalPlaces:1, analyzerIds:['ANA-003'] },
    { id:'TM-013', analyzerCode:'CREA',labosCode:'CREAT',labosName:'Creatinine',               unit:'μmol/L', refLowM:62,  refHighM:115,   refLowF:44,  refHighF:97,    critLow:null,critHigh:600,   decimalPlaces:0, analyzerIds:['ANA-003'] },
    { id:'TM-014', analyzerCode:'UREA',labosCode:'UREA', labosName:'Urea (BUN)',               unit:'mmol/L', refLowM:2.5, refHighM:7.1,   refLowF:2.5, refHighF:7.1,   critLow:null,critHigh:35.7,  decimalPlaces:1, analyzerIds:['ANA-003'] },
    { id:'TM-015', analyzerCode:'NA',  labosCode:'NA',   labosName:'Sodium',                   unit:'mmol/L', refLowM:136, refHighM:145,   refLowF:136, refHighF:145,   critLow:120, critHigh:160,   decimalPlaces:0, analyzerIds:['ANA-003'] },
    { id:'TM-016', analyzerCode:'K',   labosCode:'K',    labosName:'Potassium',                unit:'mmol/L', refLowM:3.5, refHighM:5.0,   refLowF:3.5, refHighF:5.0,   critLow:2.8, critHigh:6.5,   decimalPlaces:1, analyzerIds:['ANA-003'] },
    { id:'TM-017', analyzerCode:'CL',  labosCode:'CL',   labosName:'Chloride',                 unit:'mmol/L', refLowM:98,  refHighM:107,   refLowF:98,  refHighF:107,   critLow:null,critHigh:null,  decimalPlaces:0, analyzerIds:['ANA-003'] },
    { id:'TM-018', analyzerCode:'ALT', labosCode:'ALT',  labosName:'ALT (SGPT)',               unit:'U/L',    refLowM:7,   refHighM:56,    refLowF:7,   refHighF:45,    critLow:null,critHigh:1000,  decimalPlaces:0, analyzerIds:['ANA-003'] },
    { id:'TM-019', analyzerCode:'AST', labosCode:'AST',  labosName:'AST (SGOT)',               unit:'U/L',    refLowM:10,  refHighM:40,    refLowF:10,  refHighF:35,    critLow:null,critHigh:1000,  decimalPlaces:0, analyzerIds:['ANA-003'] },
    { id:'TM-020', analyzerCode:'ALP', labosCode:'ALP',  labosName:'Alkaline Phosphatase',     unit:'U/L',    refLowM:44,  refHighM:147,   refLowF:38,  refHighF:126,   critLow:null,critHigh:null,  decimalPlaces:0, analyzerIds:['ANA-003'] },
  ],

  gatewayResults: [
    {
      id:'GR-001', analyzerId:'ANA-001', analyzerSampleId:'SMP-20260617-001',
      analyzerBarcode:'LAB20260617001', analyzerAccession:'ACC-2026-4412',
      matchedPatientId:'PT-2026-0001', matchedRequestId:'REQ-2026-04412',
      matchMethod:'barcode', matchConfidence:'exact',
      status:'validated', receivedAt: new Date(Date.now()-1800000).toISOString(),
      analytes:[
        {code:'WBC', name:'White Blood Cell Count', value:'7.2', unit:'×10⁹/L', flag:'N', status:'normal'},
        {code:'RBC', name:'Red Blood Cell Count',   value:'4.8', unit:'×10¹²/L',flag:'N', status:'normal'},
        {code:'HGB', name:'Hemoglobin',             value:'14.2',unit:'g/dL',   flag:'N', status:'normal'},
        {code:'PLT', name:'Platelet Count',         value:'223', unit:'×10⁹/L', flag:'N', status:'normal'},
      ]
    },
    {
      id:'GR-002', analyzerId:'ANA-003', analyzerSampleId:'SMP-20260617-002',
      analyzerBarcode:'LAB20260617002', analyzerAccession:'ACC-2026-4413',
      matchedPatientId:null, matchedRequestId:null,
      matchMethod:null, matchConfidence:null,
      status:'pending', receivedAt: new Date(Date.now()-600000).toISOString(),
      analytes:[
        {code:'GLU', name:'Glucose',   value:'12.4',unit:'mmol/L',flag:'HH',status:'critical'},
        {code:'CREA',name:'Creatinine',value:'89',  unit:'μmol/L',flag:'N', status:'normal'},
        {code:'NA',  name:'Sodium',    value:'138', unit:'mmol/L',flag:'N', status:'normal'},
        {code:'K',   name:'Potassium', value:'4.1', unit:'mmol/L',flag:'N', status:'normal'},
      ]
    },
    {
      id:'GR-003', analyzerId:'ANA-001', analyzerSampleId:'SMP-20260617-003',
      analyzerBarcode:'LAB20260617003', analyzerAccession:'ACC-2026-4414',
      matchedPatientId:'PT-2026-0003', matchedRequestId:'REQ-2026-04414',
      matchMethod:'barcode', matchConfidence:'exact',
      status:'published', receivedAt: new Date(Date.now()-3600000).toISOString(),
      analytes:[
        {code:'WBC',name:'White Blood Cell Count',value:'2.1',unit:'×10⁹/L',flag:'LL',status:'critical'},
        {code:'HGB',name:'Hemoglobin',            value:'6.8',unit:'g/dL',  flag:'LL',status:'critical'},
        {code:'PLT',name:'Platelet Count',        value:'42', unit:'×10⁹/L',flag:'L', status:'low'},
      ]
    }
  ],

  gatewayMessages: [
    { id:'MSG-001', analyzerId:'ANA-001', direction:'IN', protocol:'ASTM', messageType:'OBX',
      rawData:'H|\\^&|||BC-5000^Mindray||||||P|1\rP|1\rO|1|SMP-001||^^^WBC\rR|1|^^^WBC|7.2|×10⁹/L|4.0-11.0|N|||F\rL|1|N',
      parsed:true, receivedAt: new Date(Date.now()-120000).toISOString() },
    { id:'MSG-002', analyzerId:'ANA-003', direction:'IN', protocol:'HL7', messageType:'ORU^R01',
      rawData:'MSH|^~\\&|COBAS|LAB|LABOS|RECV|20260617142203||ORU^R01|MSG001|P|2.5\rPID|1||PT002^^^LAB\rOBR|1|ACC4413\rOBX|1|NM|GLU^Glucose||12.4|mmol/L|3.9-6.1|HH|||F',
      parsed:true, receivedAt: new Date(Date.now()-600000).toISOString() },
    { id:'MSG-003', analyzerId:'ANA-004', direction:'IN', protocol:'ASTM', messageType:'ERROR',
      rawData:'H|\\^&|||KX-21\rE|COMM_TIMEOUT|Serial port read timeout after 5000ms\rL|1',
      parsed:false, parseError:'Communication timeout on COM7', receivedAt: new Date(Date.now()-900000).toISOString() },
  ],

  calibrationLog: [
    { id:'CAL-001', analyzerId:'ANA-001', calibratedBy:'Mrs. Adaeze Okonkwo', calibratorLot:'MBC-2026-04',
      calibratedAt: new Date(Date.now()-86400000*3).toISOString(), nextDueAt: new Date(Date.now()+86400000*27).toISOString(), passed:true, notes:'Routine monthly calibration. All parameters within ±2%.' },
    { id:'CAL-002', analyzerId:'ANA-003', calibratedBy:'Mr. Emeka Nwachukwu', calibratorLot:'RC311-2026-03',
      calibratedAt: new Date(Date.now()-86400000*1).toISOString(), nextDueAt: new Date(Date.now()+86400000*6).toISOString(), passed:true, notes:'Post-reagent lot change calibration. Glucose reagent lot changed to R-2026-09.' },
  ],

  syncLog: [
    { id:'SYNC-001', syncType:'result_publish', recordsSent:12, recordsOk:12, recordsFailed:0,
      syncedAt: new Date(Date.now()-300000).toISOString() },
    { id:'SYNC-002', syncType:'status_update', recordsSent:4, recordsOk:3, recordsFailed:1,
      error:'ANA-004: connection refused — TCP port 5000 unreachable', syncedAt: new Date(Date.now()-900000).toISOString() },
  ]
};

// ── Driver registry ────────────────────────────────────────────────────────────
window.ANALYZER_DRIVERS = {
  generic_astm: {
    label:'Generic ASTM Driver',   vendor:'Any',     protocol:'ASTM',
    connections:['TCP','RS232','USB'],
    description:'Standard ASTM E1381/E1394 driver. Works with most analyzers that support the ASTM LIS protocol.',
    configurable:true
  },
  generic_hl7: {
    label:'Generic HL7 Driver',    vendor:'Any',     protocol:'HL7',
    connections:['TCP'],
    description:'Standard HL7 v2.x ORU^R01 driver. Use for analyzers with a network HL7 interface.',
    configurable:true
  },
  mindray_bc3000: {
    label:'Mindray BC-3000',       vendor:'Mindray', protocol:'ASTM',
    connections:['RS232','USB'],
    description:'Dedicated driver for Mindray BC-3000 5-part differential hematology analyzer. Handles proprietary flag codes and extended parameters.'
  },
  mindray_bc5000: {
    label:'Mindray BC-5000',       vendor:'Mindray', protocol:'ASTM',
    connections:['TCP','RS232'],
    description:'Dedicated driver for Mindray BC-5000 6-part differential. Supports extended DIFF parameters and reticulocyte counting.'
  },
  sysmex_xp300: {
    label:'Sysmex XP-300',         vendor:'Sysmex',  protocol:'ASTM',
    connections:['RS232'],
    description:'Dedicated driver for Sysmex XP-300 3-part differential. Uses Sysmex-variant ASTM frame structure.'
  },
  sysmex_kx21: {
    label:'Sysmex KX-21',          vendor:'Sysmex',  protocol:'ASTM',
    connections:['RS232'],
    description:'Dedicated driver for Sysmex KX-21 3-part differential. Older RS-232 only, 2400 baud.'
  },
  roche_cobas: {
    label:'Roche Cobas c-series',  vendor:'Roche',   protocol:'HL7',
    connections:['TCP'],
    description:'Dedicated driver for Roche Cobas c111/c311/c501/c702. HL7 v2.5 interface with Roche-specific segment extensions.'
  },
  csv_file: {
    label:'CSV/TXT File Import',   vendor:'Generic', protocol:'CSV',
    connections:['FILE'],
    description:'Polls a folder for result files exported by any analyzer. Configurable column mapping. Supports .csv, .txt, and .prn formats.'
  },
  xml_file: {
    label:'XML File Import',       vendor:'Generic', protocol:'XML',
    connections:['FILE'],
    description:'Watches a folder for XML result files. Configurable XPath mapping for any schema.'
  }
};

// ── GatewayEngine ─────────────────────────────────────────────────────────────
window.GatewayEngine = (function(){

  // ─ Sample Matching ──────────────────────────────────────────────────────────
  // Priority: barcode → sample_id → accession → patient_id
  function matchSample(gatewayResult, requests, patients){
    const log = [];
    const gs = gatewayResult;

    // 1. Barcode match (most reliable — a single physical label)
    if(gs.analyzerBarcode){
      const match = requests.find(r => r.barcode === gs.analyzerBarcode || r.sampleBarcode === gs.analyzerBarcode);
      log.push({ method:'barcode', value:gs.analyzerBarcode, outcome: match ? 'matched' : 'no_match' });
      if(match) return { method:'barcode', confidence:'exact', request:match, log };
    }

    // 2. Sample ID match
    if(gs.analyzerSampleId){
      const match = requests.find(r => r.sampleId === gs.analyzerSampleId || r.displayId === gs.analyzerSampleId);
      log.push({ method:'sample_id', value:gs.analyzerSampleId, outcome: match ? 'matched' : 'no_match' });
      if(match) return { method:'sample_id', confidence:'exact', request:match, log };
    }

    // 3. Accession number match
    if(gs.analyzerAccession){
      const match = requests.find(r => r.accession === gs.analyzerAccession || r.id === gs.analyzerAccession);
      log.push({ method:'accession', value:gs.analyzerAccession, outcome: match ? 'matched' : 'no_match' });
      if(match) return { method:'accession', confidence:'probable', request:match, log };
    }

    // 4. Patient ID match — ambiguous if patient has multiple open requests
    if(gs.analyzerPatientId){
      const patient = patients.find(p => p.id === gs.analyzerPatientId || p.hospitalNumber === gs.analyzerPatientId);
      if(patient){
        const openRequests = requests.filter(r => r.patientId === patient.id && r.status !== 'released');
        if(openRequests.length === 1){
          log.push({ method:'patient_id', value:gs.analyzerPatientId, outcome:'matched', note:'Single open request' });
          return { method:'patient_id', confidence:'probable', request:openRequests[0], log };
        } else if(openRequests.length > 1){
          log.push({ method:'patient_id', value:gs.analyzerPatientId, outcome:'ambiguous', note:`${openRequests.length} open requests — manual selection required` });
          return { method:'patient_id', confidence:'ambiguous', candidates:openRequests, log };
        }
      }
      log.push({ method:'patient_id', value:gs.analyzerPatientId, outcome:'no_match' });
    }

    return { method:null, confidence:null, request:null, log };
  }

  // ─ Result Validation ────────────────────────────────────────────────────────
  function validateAnalyte(analyte, mapping, gender, previousValue){
    const alerts = [];
    const val = parseFloat(analyte.value);
    if(isNaN(val)) return [{ type:'analyzer_error', severity:'error', message:`Non-numeric value: "${analyte.value}"` }];

    const refLow  = gender === 'Female' ? mapping.refLowF  : mapping.refLowM;
    const refHigh = gender === 'Female' ? mapping.refHighF : mapping.refHighM;

    // Critical value check
    if(mapping.critLow  != null && val < mapping.critLow)  alerts.push({ type:'critical', severity:'critical', message:`CRITICAL LOW: ${val} ${mapping.unit} (critical low: ${mapping.critLow})` });
    if(mapping.critHigh != null && val > mapping.critHigh) alerts.push({ type:'critical', severity:'critical', message:`CRITICAL HIGH: ${val} ${mapping.unit} (critical high: ${mapping.critHigh})` });

    // Reference range check
    if(alerts.length === 0){
      if(refLow  != null && val < refLow)  alerts.push({ type:'ref_range', severity:'warn', message:`Low: ${val} ${mapping.unit} (ref: ${refLow}–${refHigh})` });
      if(refHigh != null && val > refHigh) alerts.push({ type:'ref_range', severity:'warn', message:`High: ${val} ${mapping.unit} (ref: ${refLow}–${refHigh})` });
    }

    // Delta check — flag if >20% change from previous value
    if(previousValue != null && !isNaN(previousValue)){
      const delta = Math.abs((val - previousValue) / previousValue) * 100;
      if(delta > 20) alerts.push({ type:'delta', severity:'warn', message:`Delta check: ${delta.toFixed(0)}% change from previous (${previousValue} → ${val})` });
    }

    if(alerts.length === 0) alerts.push({ type:'ref_range', severity:'pass', message:'Within reference range' });
    return alerts;
  }

  function validateResult(gatewayResult, mappings, gender){
    const allAlerts = [];
    for(const analyte of (gatewayResult.analytes || [])){
      const mapping = mappings.find(m => m.analyzerCode === analyte.code);
      if(!mapping){ allAlerts.push({ code:analyte.code, alerts:[{ type:'unmapped', severity:'warn', message:`No mapping found for code "${analyte.code}" — result will be held` }] }); continue; }
      const alerts = validateAnalyte(analyte, mapping, gender || 'Male', null);
      allAlerts.push({ code:analyte.code, name:mapping.labosName, alerts });
    }
    return allAlerts;
  }

  function severityClass(severity){
    return { critical:'status cancelled', warn:'status pending', pass:'status completed', error:'status rejected' }[severity] || 'status pending';
  }

  function statusBadge(status){
    const map = {
      pending:   '<span class="status pending">Pending match</span>',
      matched:   '<span class="status in-progress">Matched</span>',
      validated: '<span class="status completed">Validated</span>',
      published: '<span class="status released">Published</span>',
      rejected:  '<span class="status cancelled">Rejected</span>',
      error:     '<span class="status cancelled">Error</span>'
    };
    return map[status] || `<span class="status pending">${status}</span>`;
  }

  function analyzerStatusBadge(status){
    const map = {
      online:      '<span class="dot-badge online">Online</span>',
      offline:     '<span class="dot-badge offline">Offline</span>',
      error:       '<span class="dot-badge error">Error</span>',
      maintenance: '<span class="dot-badge maint">Maintenance</span>'
    };
    return map[status] || `<span class="dot-badge offline">${status}</span>`;
  }

  function timeAgo(iso){
    if(!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if(m < 1)  return 'Just now';
    if(m < 60) return `${m}m ago`;
    const h = Math.floor(m/60);
    if(h < 24) return `${h}h ago`;
    return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
  }

  return { matchSample, validateResult, validateAnalyte, severityClass, statusBadge, analyzerStatusBadge, timeAgo };
})();
