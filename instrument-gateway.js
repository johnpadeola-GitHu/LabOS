/* LabOS Platform — Module Manifest (generated; mirrors labos-api/src/platform/modules.js). */
window.LABOS_MODULES = [
  {
    "key": "core",
    "name": "Core Services",
    "modules": [
      {
        "key": "patients",
        "name": "Patient Management",
        "status": "live",
        "route": "/patients",
        "tables": [
          "patients"
        ]
      },
      {
        "key": "appointments",
        "name": "Appointment System",
        "status": "live",
        "route": "/appointments",
        "tables": [
          "appointments"
        ]
      },
      {
        "key": "billing",
        "name": "Billing & Invoicing",
        "status": "live",
        "route": "/invoices",
        "tables": [
          "invoices",
          "tenant_pricing"
        ]
      },
      {
        "key": "inventory",
        "name": "Inventory & Procurement",
        "status": "live",
        "route": "/inventory",
        "tables": [
          "inventory",
          "purchase_orders"
        ],
        "notes": "Inventory CRUD + purchase orders."
      },
      {
        "key": "centres",
        "name": "Multi-Center Management",
        "status": "live",
        "route": "/tenant",
        "tables": [
          "centres"
        ]
      },
      {
        "key": "analytics",
        "name": "Reporting & Analytics",
        "status": "partial",
        "route": "/analytics",
        "tables": [],
        "notes": "Frontend dashboards live; API aggregate endpoints planned."
      },
      {
        "key": "users",
        "name": "User & Role Management",
        "status": "live",
        "route": "/auth",
        "tables": [
          "users"
        ]
      },
      {
        "key": "notifications",
        "name": "Notifications Engine",
        "status": "partial",
        "route": "/notifications",
        "tables": [
          "notifications"
        ],
        "notes": "Queue + CRUD live; Termii SMS / WhatsApp / email dispatch workers planned."
      },
      {
        "key": "audit",
        "name": "Audit & Compliance",
        "status": "live",
        "tables": [
          "audit_log"
        ],
        "notes": "Append-only audit log enforced by RLS."
      },
      {
        "key": "integrations",
        "name": "API & Integrations",
        "status": "partial",
        "tables": [],
        "notes": "Paystack webhook live; HL7/FHIR, EMR connectors planned."
      }
    ]
  },
  {
    "key": "clinical",
    "name": "Clinical Diagnostics",
    "modules": [
      {
        "key": "clinical_lab",
        "name": "Clinical Laboratory",
        "status": "live",
        "route": "/requests",
        "tables": [
          "requests",
          "results",
          "samples"
        ]
      },
      {
        "key": "renal",
        "name": "Renal Laboratory",
        "status": "live",
        "route": "/dialysis",
        "tables": [
          "dialysis_sessions"
        ]
      },
      {
        "key": "molecular",
        "name": "Molecular Diagnostics",
        "status": "live",
        "route": "/molecular",
        "tables": [
          "molecular_tests"
        ]
      },
      {
        "key": "dna",
        "name": "DNA & Genetics",
        "status": "live",
        "route": "/dna-orders",
        "tables": [
          "dna_orders"
        ]
      },
      {
        "key": "histopath",
        "name": "Histopathology",
        "status": "live",
        "route": "/histopath",
        "tables": [
          "histopath_cases"
        ]
      },
      {
        "key": "microbiology",
        "name": "Microbiology",
        "status": "live",
        "route": "/microbiology",
        "tables": [
          "microbiology_results"
        ]
      },
      {
        "key": "hematology",
        "name": "Hematology",
        "status": "partial",
        "tables": [
          "results"
        ],
        "notes": "Covered by the clinical lab catalogue; dedicated panels planned."
      },
      {
        "key": "immunology",
        "name": "Immunology & Serology",
        "status": "partial",
        "tables": [
          "results"
        ],
        "notes": "Covered by the catalogue; dedicated module planned."
      },
      {
        "key": "toxicology",
        "name": "Toxicology",
        "status": "planned",
        "tables": [],
        "notes": "Drug/heavy-metal panels, confirmatory workflows."
      }
    ]
  },
  {
    "key": "imaging",
    "name": "Imaging & Diagnostic",
    "modules": [
      {
        "key": "radiology",
        "name": "Radiology",
        "status": "partial",
        "route": "/imaging-orders",
        "tables": [
          "imaging_orders"
        ],
        "notes": "Generic imaging orders live; per-modality detail planned."
      },
      {
        "key": "ultrasound",
        "name": "Ultrasound",
        "status": "partial",
        "route": "/imaging-orders",
        "tables": [
          "imaging_orders"
        ]
      },
      {
        "key": "ct",
        "name": "CT Scan",
        "status": "partial",
        "route": "/imaging-orders",
        "tables": [
          "imaging_orders"
        ]
      },
      {
        "key": "mri",
        "name": "MRI",
        "status": "partial",
        "route": "/imaging-orders",
        "tables": [
          "imaging_orders"
        ]
      },
      {
        "key": "ecg",
        "name": "ECG/EKG",
        "status": "planned",
        "tables": []
      },
      {
        "key": "echo",
        "name": "Echocardiography",
        "status": "planned",
        "tables": []
      },
      {
        "key": "diagnostic_reporting",
        "name": "Diagnostic Reporting",
        "status": "partial",
        "tables": [
          "imaging_orders"
        ],
        "notes": "Impression/report fields live; structured reporting planned."
      }
    ]
  },
  {
    "key": "biobank",
    "name": "BiobankOS",
    "modules": [
      {
        "key": "specimen_repository",
        "name": "Specimen Repository",
        "status": "live",
        "route": "/biobank/specimens",
        "tables": [
          "biobank_specimens"
        ]
      },
      {
        "key": "cryostorage",
        "name": "Cryostorage Management",
        "status": "live",
        "route": "/biobank/storage",
        "tables": [
          "biobank_storage_units",
          "biobank_storage_positions"
        ]
      },
      {
        "key": "lifecycle",
        "name": "Sample Lifecycle Tracking",
        "status": "live",
        "route": "/biobank/specimens",
        "tables": [
          "biobank_specimen_events"
        ]
      },
      {
        "key": "consent",
        "name": "Consent Management",
        "status": "live",
        "route": "/biobank/consent",
        "tables": [
          "biobank_consents"
        ]
      },
      {
        "key": "studies",
        "name": "Research Study Management",
        "status": "live",
        "route": "/biobank/studies",
        "tables": [
          "biobank_studies"
        ]
      },
      {
        "key": "barcode",
        "name": "Barcode & QR Tracking",
        "status": "live",
        "tables": [
          "biobank_specimens"
        ],
        "notes": "Each specimen carries a unique scannable code; resolve via /biobank/specimens/by-barcode/:code."
      },
      {
        "key": "chain_of_custody",
        "name": "Chain of Custody",
        "status": "live",
        "route": "/biobank/specimens",
        "tables": [
          "biobank_custody_events"
        ]
      }
    ]
  },
  {
    "key": "research",
    "name": "Research & Genomics",
    "modules": [
      {
        "key": "genomic_analysis",
        "name": "Genomic Analysis",
        "status": "planned",
        "tables": []
      },
      {
        "key": "sequencing",
        "name": "Sequencing Workflow",
        "status": "planned",
        "tables": []
      },
      {
        "key": "bioinformatics",
        "name": "Bioinformatics",
        "status": "planned",
        "tables": []
      },
      {
        "key": "clinical_trials",
        "name": "Clinical Trials",
        "status": "planned",
        "tables": [],
        "notes": "Seeded by biobank_studies; full trial management planned."
      },
      {
        "key": "cohorts",
        "name": "Cohort Management",
        "status": "planned",
        "tables": []
      },
      {
        "key": "data_warehouse",
        "name": "Research Data Warehouse",
        "status": "planned",
        "tables": []
      }
    ]
  },
  {
    "key": "admin",
    "name": "Administration",
    "modules": [
      {
        "key": "org_settings",
        "name": "Organization Settings",
        "status": "live",
        "route": "/tenant",
        "tables": [
          "tenants"
        ],
        "notes": "Legal identity locked; branding self-service."
      },
      {
        "key": "branches",
        "name": "Branch Management",
        "status": "live",
        "route": "/tenant",
        "tables": [
          "centres"
        ]
      },
      {
        "key": "pricing",
        "name": "Pricing & Plans",
        "status": "live",
        "tables": [
          "plans",
          "tenant_pricing"
        ]
      },
      {
        "key": "devices",
        "name": "Device Management",
        "status": "live",
        "route": "/devices",
        "tables": [
          "devices"
        ]
      },
      {
        "key": "security",
        "name": "Security Center",
        "status": "partial",
        "tables": [
          "audit_log",
          "licences"
        ],
        "notes": "RLS + licensing + audit live; consolidated security UI planned."
      },
      {
        "key": "backup",
        "name": "Backup & Recovery",
        "status": "planned",
        "tables": [],
        "notes": "Operational concern — managed Postgres PITR + export tooling."
      }
    ]
  }
];
window.LABOS_COVERAGE = {"total":45,"live":24,"partial":11,"planned":10,"pctLiveOrPartial":78};
