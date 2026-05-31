/* ============================================================
   LabOS — Quality Control Engine (ISO 15189 / CLIA)
   Westgard multi-rule QC evaluation for analytical instruments.
   Exposed as window.QC for use in the QC renderer.
   ============================================================ */

/* ── QC seed data: simulated 30-day run history for key analytes ── */
window.QC_ANALYTES = [
  {
    code:'GLUC', name:'Glucose', unit:'mmol/L',
    target:5.5, sd:0.18,                 // target mean + expected SD for this QC lot
    instrument:'Roche cobas c311', lot:'QC-LOT-GLU-2605', level:'Level 2 (normal)',
    warnSD:2, rejectSD:3
  },
  {
    code:'CREAT', name:'Creatinine', unit:'μmol/L',
    target:88.4, sd:2.6,
    instrument:'Roche cobas c311', lot:'QC-LOT-CRE-2605', level:'Level 2 (normal)',
    warnSD:2, rejectSD:3
  },
  {
    code:'NA', name:'Sodium', unit:'mmol/L',
    target:141, sd:1.4,
    instrument:'Siemens ADVIA', lot:'QC-LOT-ELE-2605', level:'Level 2 (normal)',
    warnSD:2, rejectSD:3
  },
  {
    code:'HGB', name:'Haemoglobin', unit:'g/dL',
    target:14.8, sd:0.3,
    instrument:'Sysmex XN-350', lot:'QC-LOT-HEM-2605', level:'Level 2 (normal)',
    warnSD:2, rejectSD:3
  },
  {
    code:'HBA1C', name:'HbA1c', unit:'%',
    target:6.8, sd:0.12,
    instrument:'Roche cobas c311', lot:'QC-LOT-HBA-2605', level:'Level 2 (normal)',
    warnSD:2, rejectSD:3
  },
  {
    code:'CRP', name:'C-Reactive Protein', unit:'mg/L',
    target:4.2, sd:0.35,
    instrument:'Roche cobas c311', lot:'QC-LOT-CRP-2605', level:'Level 2 (normal)',
    warnSD:2, rejectSD:3
  }
];

/* Seed 30 QC runs per analyte with realistic variation */
(function seedQcRuns(){
  const runs = window.QC_RUNS = {};
  const base = new Date('2026-05-01T08:00:00');
  const rng = (seed) => {
    let x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  window.QC_ANALYTES.forEach((a, ai) => {
    runs[a.code] = [];
    for(let i = 0; i < 30; i++){
      const date = new Date(base);
      date.setDate(date.getDate() + i);
      // Mostly in-control, occasional near-warning, rare out-of-control
      let shift = 0;
      if(i === 8)  shift = 2.1;   // 2.1s — warning
      if(i === 18) shift = -2.3;  // 2.3s — warning
      if(i === 24) shift = 3.1;   // 3.1s — out-of-control
      const noise = (rng(ai * 100 + i) - 0.5) * 2 * a.sd;
      const result = +(a.target + noise + shift * a.sd).toFixed(a.sd < 1 ? 2 : 1);
      const z = (result - a.target) / a.sd;
      runs[a.code].push({
        id: `QC-${a.code}-${String(i+1).padStart(3,'0')}`,
        date: date.toISOString().slice(0,10),
        time: '08:' + String(Math.floor(rng(ai+i)*59)).padStart(2,'0'),
        result, z: +z.toFixed(2),
        operator: ['Ngozi Adebola','Kelechi Eze','Sadia Adamu'][i%3],
        accepted: null  // set by Westgard evaluation below
      });
    }
  });
})();

/* ── Westgard multi-rule engine ──────────────────────────────────
   Returns { status, violations } for an array of QC points.
   status: 'in-control' | 'warning' | 'reject'
   violations: array of { rule, indices, description }
   ──────────────────────────────────────────────────────────────── */
window.QC = {

  evaluate(runs) {
    if(!runs || runs.length < 2) return { status:'in-control', violations:[] };
    const z = runs.map(r => r.z);
    const violations = [];
    const n = z.length;

    // 1₂s — warning: any single point outside ±2 SD
    z.forEach((zi, i) => {
      if(Math.abs(zi) > 2 && Math.abs(zi) <= 3) {
        violations.push({ rule:'1₂s', indices:[i],
          description:`Point ${i+1}: z=${zi.toFixed(2)} — outside 2 SD (warning)`, level:'warning' });
      }
    });

    // 1₃s — reject: any single point outside ±3 SD
    z.forEach((zi, i) => {
      if(Math.abs(zi) > 3) {
        violations.push({ rule:'1₃s', indices:[i],
          description:`Point ${i+1}: z=${zi.toFixed(2)} — outside 3 SD (REJECT)`, level:'reject' });
      }
    });

    // 2₂s — reject: two consecutive points on same side, both outside 2 SD
    for(let i = 1; i < n; i++) {
      if(Math.abs(z[i]) > 2 && Math.abs(z[i-1]) > 2 &&
         Math.sign(z[i]) === Math.sign(z[i-1])) {
        violations.push({ rule:'2₂s', indices:[i-1, i],
          description:`Points ${i},${i+1}: consecutive outside 2 SD same side (REJECT)`, level:'reject' });
      }
    }

    // R₄s — reject: range of two consecutive points exceeds 4 SD
    for(let i = 1; i < n; i++) {
      if(Math.abs(z[i] - z[i-1]) > 4) {
        violations.push({ rule:'R₄s', indices:[i-1, i],
          description:`Points ${i},${i+1}: range ${Math.abs(z[i]-z[i-1]).toFixed(2)} SD exceeds 4 SD (REJECT)`, level:'reject' });
      }
    }

    // 4₁s — reject: four consecutive points outside 1 SD on same side
    for(let i = 3; i < n; i++) {
      const seg = z.slice(i-3, i+1);
      if(seg.every(zi => zi > 1) || seg.every(zi => zi < -1)) {
        violations.push({ rule:'4₁s', indices:[i-3,i-2,i-1,i],
          description:`Points ${i-2}–${i+1}: 4 consecutive outside 1 SD same side (REJECT)`, level:'reject' });
      }
    }

    // 10ₓ — reject: 10 consecutive points on same side of mean
    for(let i = 9; i < n; i++) {
      const seg = z.slice(i-9, i+1);
      if(seg.every(zi => zi > 0) || seg.every(zi => zi < 0)) {
        violations.push({ rule:'10ₓ', indices:seg.map((_,j) => i-9+j),
          description:`Points ${i-8}–${i+1}: 10 consecutive on same side of mean (REJECT)`, level:'reject' });
      }
    }

    // 7T — warning: 7 consecutive points trending in same direction
    for(let i = 6; i < n; i++) {
      const seg = z.slice(i-6, i+1);
      const upward   = seg.every((zi, j) => j === 0 || zi >= seg[j-1]);
      const downward = seg.every((zi, j) => j === 0 || zi <= seg[j-1]);
      if(upward || downward) {
        violations.push({ rule:'7T', indices:seg.map((_,j) => i-6+j),
          description:`Points ${i-5}–${i+1}: 7-point ${upward?'upward':'downward'} trend (warning)`, level:'warning' });
      }
    }

    const hasReject  = violations.some(v => v.level === 'reject');
    const hasWarning = violations.some(v => v.level === 'warning');
    const status = hasReject ? 'reject' : hasWarning ? 'warning' : 'in-control';

    // Tag each run point with its status
    const pointStatus = runs.map((_, i) => {
      const relevant = violations.filter(v => v.indices.includes(i));
      if(relevant.some(v => v.level === 'reject'))  return 'reject';
      if(relevant.some(v => v.level === 'warning')) return 'warning';
      return 'ok';
    });

    return { status, violations, pointStatus };
  },

  /* CVwithin-run (%) for a set of z-scores */
  cv(runs) {
    if(!runs || runs.length < 2) return null;
    const results = runs.map(r => r.result);
    const mean = results.reduce((s,v) => s+v, 0) / results.length;
    const sd = Math.sqrt(results.reduce((s,v) => s+(v-mean)**2, 0) / (results.length-1));
    return mean ? +((sd/mean)*100).toFixed(2) : null;
  },

  /* Bias from target (%) */
  bias(runs, target) {
    if(!runs || runs.length < 2 || !target) return null;
    const mean = runs.reduce((s,r) => s+r.result, 0) / runs.length;
    return +(((mean - target) / target) * 100).toFixed(2);
  },

  /* Submit a new QC run and return { run, evaluation } */
  submitRun(analyteName, result, operator) {
    const analyte = (window.QC_ANALYTES || []).find(a => a.name === analyteName || a.code === analyteName);
    if(!analyte) return null;
    const z = +((result - analyte.target) / analyte.sd).toFixed(2);
    const id = `QC-${analyte.code}-${String((window.QC_RUNS[analyte.code]||[]).length + 1).padStart(3,'0')}`;
    const run = {
      id, result: +result, z,
      date: new Date().toISOString().slice(0,10),
      time: new Date().toTimeString().slice(0,5),
      operator: operator || 'Lab Scientist',
      accepted: null
    };
    if(!window.QC_RUNS) window.QC_RUNS = {};
    if(!window.QC_RUNS[analyte.code]) window.QC_RUNS[analyte.code] = [];
    window.QC_RUNS[analyte.code].unshift(run);
    const eval30 = window.QC_RUNS[analyte.code].slice(0, 30);
    const evaluation = window.QC.evaluate(eval30.reverse());
    run.accepted = evaluation.status !== 'reject';
    return { run, evaluation };
  }
};
