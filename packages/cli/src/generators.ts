// ============================================================================
// Dataset Generators — Deterministic, Seeded, Comprehensive
// ============================================================================

// --- Seeded PRNG (Mulberry32) ---
export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_SEED = 42;

// ---- Original Generators (now with optional seed) ----

export function generateFlat(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    email: `user${i}@example.com`,
    active: i % 2 === 0,
    role: i % 10 === 0 ? 'admin' : 'user',
    createdAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T${String(Math.floor(rng() * 24)).padStart(2, '0')}:00:00Z`,
  }));
}

export function generateNested(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    user: {
      name: `User ${i}`,
      profile: {
        bio: `Bio for user ${i}`,
        age: 20 + (i % 50),
        socials: [
          { platform: 'twitter', handle: `@user${i}` },
          { platform: 'linkedin', handle: `user-${i}` },
        ],
      },
    },
    settings: {
      theme: i % 2 === 0 ? 'dark' : 'light',
      notifications: {
        email: true,
        push: false,
      },
    },
  }));
}

export function generateSparse(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => {
    const obj: any = { id: i };
    if (i % 10 === 0) obj.description = `Description for ${i}`;
    if (i % 50 === 0) obj.metadata = { region: 'us-east-1' };
    if (i % 100 === 0) obj.tags = ['sparse', 'data'];
    return obj;
  });
}

export function generateRepetitive(count: number, seed = DEFAULT_SEED) {
  const statuses = ['active', 'pending', 'deleted'];
  const types = ['user', 'group', 'org'];
  return Array.from({ length: count }, (_, i) => ({
    status: statuses[i % statuses.length],
    type: types[i % types.length],
    region: 'us-west-2',
    version: '1.0.0',
    tags: ['production', 'stable'],
  }));
}

export function generateLongText(count: number, seed = DEFAULT_SEED) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    title: `Article ${i}`,
    content:
      `SECTION ${i}\n` +
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20) +
      'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(10) +
      `END SECTION ${i}`,
  }));
}

export function generateRealWorld(count: number, seed = DEFAULT_SEED) {
  const statuses = ['open', 'resolved', 'pending', 'escalated'];
  const priorities = ['low', 'medium', 'high', 'critical'];
  const categories = ['billing', 'technical', 'account', 'shipping', 'returns'];
  const rng = seededRandom(seed);

  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    customer: `customer_${(i * 7 + 3) % 1000}`,
    subject: `Issue with ${categories[i % categories.length]} #${i + 1}`,
    status: statuses[i % statuses.length],
    priority: priorities[i % priorities.length],
    category: categories[i % categories.length],
    created: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    agent: i % 3 === 0 ? null : `agent_${(i % 5) + 1}`,
    notes: 'Customer reported issue via email. ' + 'Please investigate. '.repeat(i % 5),
  }));
}

// ============================================================================
// NEW Generators — Pathological / Edge Case Datasets
// ============================================================================

/**
 * Wide Schema — tests format sensitivity to column count.
 * @param count Number of rows
 * @param columns Number of columns (default 40)
 */
export function generateWideSchema(count: number, columns = 40, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const types = ['string', 'number', 'boolean'] as const;

  return Array.from({ length: count }, (_, i) => {
    const obj: Record<string, unknown> = { id: i };
    for (let c = 1; c < columns; c++) {
      const type = types[c % types.length];
      const key = `col_${String(c).padStart(3, '0')}`;
      switch (type) {
        case 'string':
          obj[key] = `val_${i}_${c}`;
          break;
        case 'number':
          obj[key] = Math.floor(rng() * 10000) / 100;
          break;
        case 'boolean':
          obj[key] = rng() > 0.5;
          break;
      }
    }
    return obj;
  });
}

/**
 * Deep Nested — tests format behavior with nesting depth > 3.
 * Creates recursive nesting up to the specified depth.
 */
export function generateDeepNested(count: number, depth = 5, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);

  function buildNested(currentDepth: number, index: number): any {
    if (currentDepth <= 0) {
      return {
        leaf_value: `v_${index}_d${depth - currentDepth}`,
        leaf_num: Math.floor(rng() * 1000),
        leaf_flag: rng() > 0.5,
      };
    }
    return {
      label: `level_${currentDepth}`,
      metadata: { depth: currentDepth, index },
      children: [buildNested(currentDepth - 1, index)],
    };
  }

  return Array.from({ length: count }, (_, i) => ({
    id: i,
    type: 'deep_nested',
    root: buildNested(depth, i),
  }));
}

/**
 * Mixed Nested + Tabular — tests formats with heterogeneous row shapes.
 * Even rows are flat, odd rows have nested objects.
 */
export function generateMixedNestedTabular(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => {
    if (i % 2 === 0) {
      // Flat row
      return {
        id: i,
        name: `flat_user_${i}`,
        score: Math.floor(rng() * 100),
        active: rng() > 0.3,
        category: ['A', 'B', 'C'][i % 3],
      };
    } else {
      // Nested row
      return {
        id: i,
        name: `nested_user_${i}`,
        profile: {
          bio: `Bio text for nested user ${i}`,
          settings: {
            theme: rng() > 0.5 ? 'dark' : 'light',
            lang: ['en', 'es', 'fr', 'de'][i % 4],
          },
        },
        tags: [`tag_${i % 5}`, `tag_${(i + 1) % 5}`],
      };
    }
  });
}

/**
 * Extremely Sparse — 90% null fields.
 * 20 defined columns, only 2-3 populated per row.
 */
export function generateExtremelySparse(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const allFields = Array.from({ length: 20 }, (_, c) => `field_${String(c).padStart(2, '0')}`);

  return Array.from({ length: count }, (_, i) => {
    const obj: Record<string, unknown> = { id: i };
    // Populate only 2-3 fields randomly
    const numPopulated = 2 + (rng() > 0.5 ? 1 : 0);
    const populated = new Set<number>();
    while (populated.size < numPopulated) {
      populated.add(Math.floor(rng() * allFields.length));
    }

    for (let c = 0; c < allFields.length; c++) {
      if (populated.has(c)) {
        obj[allFields[c]] = c % 2 === 0 ? `sparse_val_${i}_${c}` : Math.floor(rng() * 1000);
      } else {
        obj[allFields[c]] = null;
      }
    }
    return obj;
  });
}

/**
 * Short Strings — all values are 1-5 character strings.
 * Tests tokenizer behavior with very short tokens.
 */
export function generateShortStrings(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const chars = 'abcdefghijklmnopqrstuvwxyz';

  function shortStr(len: number): string {
    let s = '';
    for (let i = 0; i < len; i++) {
      s += chars[Math.floor(rng() * chars.length)];
    }
    return s;
  }

  return Array.from({ length: count }, (_, i) => ({
    id: i,
    a: shortStr(1 + Math.floor(rng() * 5)),
    b: shortStr(1 + Math.floor(rng() * 5)),
    c: shortStr(1 + Math.floor(rng() * 5)),
    d: shortStr(1 + Math.floor(rng() * 5)),
    e: shortStr(1 + Math.floor(rng() * 5)),
  }));
}

/**
 * Numeric Heavy — mostly numbers, no string values except ID.
 * Tests how formats handle numeric-dense data.
 */
export function generateNumericHeavy(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    int_val: Math.floor(rng() * 100000),
    float_val: rng() * 1000,
    neg_int: -Math.floor(rng() * 50000),
    small_float: rng(),
    big_int: Math.floor(rng() * 1e9),
    ratio: rng() / (rng() + 0.001),
    count: i * 7 + 3,
    pct: Math.floor(rng() * 10000) / 100,
    zero: 0,
    flag_num: rng() > 0.5 ? 1 : 0,
  }));
}

// ============================================================================
// Industry-Specific Generators — Real Production Data Shapes
// ============================================================================

/**
 * E-commerce products with variants, reviews, and pricing.
 * High cardinality strings, nested arrays, mixed types.
 */
export function generateEcommerce(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const categories = [
    'Electronics',
    'Clothing',
    'Home & Garden',
    'Sports',
    'Books',
    'Toys',
    'Food',
    'Beauty',
  ];
  const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const colors = ['Black', 'White', 'Red', 'Blue', 'Green', 'Navy', 'Grey', 'Beige'];
  const conditions = ['new', 'refurbished', 'used'];

  return Array.from({ length: count }, (_, i) => {
    const numVariants = 1 + Math.floor(rng() * 4);
    const numReviews = Math.floor(rng() * 6);
    return {
      sku: `SKU-${String(100000 + i).slice(1)}`,
      title: `Product ${i} - ${categories[i % categories.length]} Item`,
      description:
        `High-quality ${categories[i % categories.length].toLowerCase()} product. `.repeat(
          2 + Math.floor(rng() * 3),
        ),
      category: categories[i % categories.length],
      brand: `Brand_${Math.floor(rng() * 50)}`,
      price: Math.round(rng() * 99900 + 100) / 100,
      currency: i % 20 === 0 ? 'EUR' : i % 10 === 0 ? 'GBP' : 'USD',
      inStock: rng() > 0.2,
      condition: conditions[Math.floor(rng() * conditions.length)],
      variants: Array.from({ length: numVariants }, (_, v) => ({
        size: sizes[Math.floor(rng() * sizes.length)],
        color: colors[Math.floor(rng() * colors.length)],
        additionalPrice: Math.round(rng() * 2000) / 100,
        available: rng() > 0.3,
      })),
      reviews: Array.from({ length: numReviews }, (_, r) => ({
        rating: 1 + Math.floor(rng() * 5),
        author: `user_${Math.floor(rng() * 10000)}`,
        text: `Review of product ${i}. ${'Good quality. '.repeat(1 + Math.floor(rng() * 3))}`,
        verified: rng() > 0.4,
      })),
      tags: [`tag_${i % 20}`, `tag_${(i + 7) % 20}`],
      weight_kg: Math.round(rng() * 5000) / 100,
      created: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    };
  });
}

/**
 * Healthcare patient records with vitals, medications, and diagnosis codes.
 * HIPAA-style structure: deeply nested, sparse optional fields.
 */
export function generateHealthcare(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const conditions_list = [
    'Hypertension',
    'Type 2 Diabetes',
    'Asthma',
    'COPD',
    'Anxiety',
    'Depression',
    'Arthritis',
    null,
  ];
  const medications = [
    'Metformin',
    'Lisinopril',
    'Atorvastatin',
    'Amlodipine',
    'Omeprazole',
    'Levothyroxine',
  ];
  const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  const statuses = ['active', 'discharged', 'follow-up', 'critical'];

  return Array.from({ length: count }, (_, i) => {
    const numMeds = Math.floor(rng() * 4);
    const numDiagnoses = 1 + Math.floor(rng() * 3);
    return {
      patientId: `PT-${String(1000000 + i).slice(1)}`,
      mrn: `MRN${String(i * 13 + 7).padStart(8, '0')}`,
      demographics: {
        age: 18 + Math.floor(rng() * 72),
        sex: rng() > 0.5 ? 'M' : 'F',
        bloodType: bloodTypes[Math.floor(rng() * bloodTypes.length)],
        ethnicity: ['Caucasian', 'Hispanic', 'African American', 'Asian', 'Other'][
          Math.floor(rng() * 5)
        ],
      },
      vitals: {
        systolic: 90 + Math.floor(rng() * 80),
        diastolic: 55 + Math.floor(rng() * 50),
        heartRate: 55 + Math.floor(rng() * 60),
        temperature: Math.round((97 + rng() * 4) * 10) / 10,
        oxygenSat: 92 + Math.floor(rng() * 8),
        respiratoryRate: 12 + Math.floor(rng() * 12),
      },
      diagnoses: Array.from({ length: numDiagnoses }, () => ({
        icdCode: `${String.fromCharCode(65 + Math.floor(rng() * 26))}${Math.floor(rng() * 99)}.${Math.floor(rng() * 9)}`,
        description: conditions_list[Math.floor(rng() * conditions_list.length)],
        primary: rng() > 0.7,
      })),
      medications: Array.from({ length: numMeds }, () => ({
        name: medications[Math.floor(rng() * medications.length)],
        dosage: `${[5, 10, 20, 25, 50, 100][Math.floor(rng() * 6)]}mg`,
        frequency: ['daily', 'twice daily', 'as needed', 'weekly'][Math.floor(rng() * 4)],
      })),
      allergies: rng() > 0.6 ? ['Penicillin', 'Sulfa'][Math.floor(rng() * 2)] : null,
      status: statuses[i % statuses.length],
      admittedDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      notes:
        rng() > 0.3
          ? `Patient presenting with ${conditions_list[Math.floor(rng() * (conditions_list.length - 1))]}. ` +
            'Continue monitoring. '.repeat(Math.floor(rng() * 3))
          : null,
    };
  });
}

/**
 * IoT sensor telemetry — high-volume time-series data.
 * Numeric-heavy, uniform schema, timestamp-indexed.
 */
export function generateIoT(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const sensorTypes = ['temperature', 'humidity', 'pressure', 'vibration', 'voltage', 'current'];
  const locations = [
    'floor_1_zone_a',
    'floor_1_zone_b',
    'floor_2_zone_a',
    'floor_2_zone_b',
    'roof',
    'basement',
  ];
  const statuses = ['ok', 'warning', 'critical', 'maintenance'];

  return Array.from({ length: count }, (_, i) => ({
    deviceId: `sensor_${String(i % 200).padStart(4, '0')}`,
    sensorType: sensorTypes[i % sensorTypes.length],
    location: locations[Math.floor(rng() * locations.length)],
    timestamp: `2026-01-15T${String(Math.floor(i / 3600) % 24).padStart(2, '0')}:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
    readings: {
      value: Math.round((rng() * 200 - 50) * 100) / 100,
      min: Math.round((rng() * 100 - 50) * 100) / 100,
      max: Math.round(rng() * 200 * 100) / 100,
      avg: Math.round((rng() * 150 - 25) * 100) / 100,
      stdDev: Math.round(rng() * 15 * 100) / 100,
    },
    batteryPct: Math.floor(rng() * 100),
    signalStrength: -30 - Math.floor(rng() * 70),
    status: statuses[Math.floor(rng() * statuses.length)],
    alerts:
      rng() > 0.85
        ? [{ code: `ALT_${Math.floor(rng() * 50)}`, severity: rng() > 0.5 ? 'high' : 'medium' }]
        : [],
    firmware: `v${1 + Math.floor(rng() * 3)}.${Math.floor(rng() * 10)}.${Math.floor(rng() * 20)}`,
  }));
}

/**
 * Financial transactions — precision-critical, enum-heavy.
 * Includes amounts, currencies, settlement info, audit metadata.
 */
export function generateFinancial(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const types = ['debit', 'credit', 'transfer', 'refund', 'fee', 'interest'];
  const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF'];
  const statuses = ['completed', 'pending', 'failed', 'reversed', 'processing'];
  const categories = [
    'payroll',
    'vendor',
    'subscription',
    'refund',
    'tax',
    'utilities',
    'marketing',
    'travel',
  ];

  return Array.from({ length: count }, (_, i) => ({
    txId: `TX-${String(10000000 + i).slice(1)}`,
    type: types[i % types.length],
    amount: Math.round((rng() * 50000 + 1) * 100) / 100,
    currency: currencies[Math.floor(rng() * currencies.length)],
    fromAccount: `ACC${String(Math.floor(rng() * 10000)).padStart(6, '0')}`,
    toAccount: `ACC${String(Math.floor(rng() * 10000)).padStart(6, '0')}`,
    status: statuses[Math.floor(rng() * statuses.length)],
    category: categories[Math.floor(rng() * categories.length)],
    timestamp: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T${String(Math.floor(rng() * 24)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')}:00Z`,
    settlement: {
      date: `2026-01-${String(((i + 2) % 28) + 1).padStart(2, '0')}`,
      method: ['ACH', 'wire', 'card', 'crypto'][Math.floor(rng() * 4)],
      reference: `REF${Math.floor(rng() * 1e8)}`,
    },
    metadata: {
      ip: `${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}`,
      userAgent: rng() > 0.5 ? 'mobile-app/3.2' : 'web/2.1',
      riskScore: Math.round(rng() * 100),
    },
    fees: Math.round(rng() * 500) / 100,
    taxAmount: i % 3 === 0 ? Math.round(rng() * 1000) / 100 : null,
  }));
}

/**
 * Server log events — variable nesting, long messages, sparse fields.
 * DevOps/observability use case.
 */
export function generateLogEvents(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
  const services = [
    'api-gateway',
    'auth-service',
    'payment-service',
    'user-service',
    'notification-service',
    'search-service',
  ];
  const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

  return Array.from({ length: count }, (_, i) => {
    const level = levels[Math.floor(rng() * levels.length)];
    const isError = level === 'ERROR' || level === 'FATAL';
    return {
      id: `log_${String(i).padStart(8, '0')}`,
      timestamp: `2026-01-15T${String(Math.floor(rng() * 24)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')}.${String(Math.floor(rng() * 1000)).padStart(3, '0')}Z`,
      level,
      service: services[Math.floor(rng() * services.length)],
      message: isError
        ? `${methods[Math.floor(rng() * methods.length)]} /api/v2/${services[Math.floor(rng() * services.length)].split('-')[0]} failed with status ${[400, 401, 403, 500, 502, 503][Math.floor(rng() * 6)]}`
        : `${methods[Math.floor(rng() * methods.length)]} /api/v2/resource/${Math.floor(rng() * 1000)} completed in ${Math.floor(rng() * 2000)}ms`,
      context: {
        requestId: `req_${Math.floor(rng() * 1e10)}`,
        userId: rng() > 0.3 ? `usr_${Math.floor(rng() * 50000)}` : null,
        traceId: `trace_${Math.floor(rng() * 1e12)}`,
        spanId: `span_${Math.floor(rng() * 1e8)}`,
      },
      httpStatus: 200 + Math.floor(rng() * 400),
      duration_ms: Math.floor(rng() * 5000),
      stackTrace:
        isError && rng() > 0.5
          ? `Error: Operation failed\n    at handler (${services[0]}/src/routes.ts:${Math.floor(rng() * 500)})\n    at processRequest (core/server.ts:${Math.floor(rng() * 200)})`
          : null,
      tags: isError ? ['error', 'alert'] : ['request'],
    };
  });
}

/**
 * User activity / clickstream — SaaS analytics use case.
 * High cardinality actions, repetitive structure, session grouping.
 */
export function generateUserActivity(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const actions = [
    'page_view',
    'click',
    'scroll',
    'form_submit',
    'search',
    'add_to_cart',
    'purchase',
    'logout',
    'share',
    'download',
  ];
  const pages = [
    '/home',
    '/products',
    '/product/detail',
    '/cart',
    '/checkout',
    '/profile',
    '/settings',
    '/search',
    '/help',
    '/about',
  ];
  const devices = ['desktop', 'mobile', 'tablet'];
  const browsers = ['Chrome', 'Firefox', 'Safari', 'Edge'];
  const os_list = ['Windows', 'macOS', 'iOS', 'Android', 'Linux'];

  return Array.from({ length: count }, (_, i) => ({
    eventId: `evt_${String(i).padStart(10, '0')}`,
    sessionId: `sess_${Math.floor(i / (5 + Math.floor(rng() * 15)))}`,
    userId: `usr_${Math.floor(rng() * 5000)}`,
    action: actions[Math.floor(rng() * actions.length)],
    page: pages[Math.floor(rng() * pages.length)],
    timestamp: `2026-01-15T${String(Math.floor(rng() * 24)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')}Z`,
    properties: {
      referrer: rng() > 0.5 ? pages[Math.floor(rng() * pages.length)] : 'direct',
      scrollDepth: Math.floor(rng() * 100),
      timeOnPage: Math.floor(rng() * 300),
      elementId: rng() > 0.4 ? `btn_${Math.floor(rng() * 100)}` : null,
    },
    device: {
      type: devices[Math.floor(rng() * devices.length)],
      browser: browsers[Math.floor(rng() * browsers.length)],
      os: os_list[Math.floor(rng() * os_list.length)],
      screenWidth: [375, 768, 1024, 1440, 1920][Math.floor(rng() * 5)],
    },
    geo: {
      country: ['US', 'GB', 'DE', 'FR', 'JP', 'IN', 'BR', 'CA'][Math.floor(rng() * 8)],
      region: `region_${Math.floor(rng() * 50)}`,
    },
    abTest:
      rng() > 0.6
        ? {
            experiment: `exp_${Math.floor(rng() * 10)}`,
            variant: rng() > 0.5 ? 'control' : 'treatment',
          }
        : null,
  }));
}

/**
 * Chat/LLM conversation messages — exactly the format injected into LLM context.
 * Tests how well Contex handles its own primary use case.
 */
export function generateChatMessages(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const roles = ['system', 'user', 'assistant', 'tool'];
  const models = ['gpt-4o', 'claude-3.5-sonnet', 'gemini-2.0-flash'];
  const toolNames = ['search_web', 'calculate', 'get_weather', 'lookup_user', 'run_query'];

  return Array.from({ length: count }, (_, i) => {
    const role = roles[i % 4 === 0 ? 0 : i % 3 === 0 ? 3 : i % 2 === 0 ? 2 : 1];
    const hasTool = role === 'assistant' && rng() > 0.6;
    return {
      id: `msg_${String(i).padStart(8, '0')}`,
      conversationId: `conv_${Math.floor(i / (4 + Math.floor(rng() * 8)))}`,
      role,
      content:
        role === 'system'
          ? 'You are a helpful assistant. Answer questions accurately and concisely.'
          : role === 'tool'
            ? JSON.stringify({
                result: `Tool result for query ${i}`,
                status: 'success',
                data: { value: Math.floor(rng() * 1000) },
              })
            : `${'This is a message from the ' + role + '. '}${'Additional context and information. '.repeat(1 + Math.floor(rng() * 5))}`,
      model: role === 'assistant' ? models[Math.floor(rng() * models.length)] : null,
      toolCalls: hasTool
        ? [
            {
              id: `call_${Math.floor(rng() * 1e8)}`,
              type: 'function',
              function: {
                name: toolNames[Math.floor(rng() * toolNames.length)],
                arguments: JSON.stringify({
                  query: `search term ${i}`,
                  limit: Math.floor(rng() * 20),
                }),
              },
            },
          ]
        : null,
      tokens: {
        prompt: Math.floor(rng() * 2000),
        completion: role === 'assistant' ? Math.floor(rng() * 1000) : 0,
      },
      latency_ms: role === 'assistant' ? Math.floor(rng() * 5000) : null,
      timestamp: `2026-01-15T${String(Math.floor(rng() * 24)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')}Z`,
    };
  });
}

/**
 * Paginated API responses — wrapper overhead, pagination metadata.
 * Tests how formats handle structural wrappers around actual data.
 */
export function generateApiResponses(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const endpoints = ['/users', '/orders', '/products', '/events', '/invoices'];
  const versions = ['v1', 'v2', 'v3'];

  return Array.from({ length: count }, (_, i) => {
    const pageSize = 10 + Math.floor(rng() * 40);
    const totalItems = 50 + Math.floor(rng() * 950);
    const currentPage = 1 + Math.floor(rng() * Math.ceil(totalItems / pageSize));
    return {
      requestId: `req_${Math.floor(rng() * 1e10)}`,
      endpoint: `${endpoints[i % endpoints.length]}`,
      version: versions[Math.floor(rng() * versions.length)],
      status: 200,
      data: Array.from({ length: Math.min(pageSize, 5) }, (_, j) => ({
        id: currentPage * pageSize + j,
        name: `item_${currentPage * pageSize + j}`,
        value: Math.round(rng() * 10000) / 100,
        active: rng() > 0.2,
      })),
      meta: {
        page: currentPage,
        perPage: pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
        hasNext: currentPage < Math.ceil(totalItems / pageSize),
        hasPrev: currentPage > 1,
      },
      links: {
        self: `/api/${versions[0]}${endpoints[i % endpoints.length]}?page=${currentPage}`,
        next:
          currentPage < Math.ceil(totalItems / pageSize)
            ? `/api/${versions[0]}${endpoints[i % endpoints.length]}?page=${currentPage + 1}`
            : null,
        prev:
          currentPage > 1
            ? `/api/${versions[0]}${endpoints[i % endpoints.length]}?page=${currentPage - 1}`
            : null,
      },
      rateLimit: {
        limit: 1000,
        remaining: 1000 - Math.floor(rng() * 200),
        resetAt: `2026-01-15T${String(Math.floor(rng() * 24)).padStart(2, '0')}:00:00Z`,
      },
      responseTime_ms: Math.floor(rng() * 500),
    };
  });
}

/**
 * Geo/location data — float precision, nested address objects.
 * Maps/logistics use case.
 */
export function generateGeoData(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const types = [
    'restaurant',
    'hotel',
    'office',
    'retail',
    'warehouse',
    'hospital',
    'school',
    'park',
  ];
  const countries = ['US', 'GB', 'DE', 'JP', 'AU', 'CA', 'FR', 'BR'];
  const cities: Record<string, string[]> = {
    US: ['New York', 'San Francisco', 'Chicago', 'Austin', 'Seattle'],
    GB: ['London', 'Manchester', 'Birmingham', 'Edinburgh'],
    DE: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt'],
    JP: ['Tokyo', 'Osaka', 'Kyoto', 'Yokohama'],
    AU: ['Sydney', 'Melbourne', 'Brisbane', 'Perth'],
    CA: ['Toronto', 'Vancouver', 'Montreal', 'Calgary'],
    FR: ['Paris', 'Lyon', 'Marseille', 'Toulouse'],
    BR: ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador'],
  };

  return Array.from({ length: count }, (_, i) => {
    const country = countries[i % countries.length];
    const cityList = cities[country] || ['Unknown'];
    return {
      placeId: `place_${String(i).padStart(6, '0')}`,
      name: `${types[i % types.length].charAt(0).toUpperCase() + types[i % types.length].slice(1)} #${i}`,
      type: types[i % types.length],
      coordinates: {
        lat: Math.round((-90 + rng() * 180) * 1e6) / 1e6,
        lng: Math.round((-180 + rng() * 360) * 1e6) / 1e6,
        altitude: rng() > 0.7 ? Math.round(rng() * 3000) : null,
      },
      address: {
        street: `${Math.floor(rng() * 9999)} ${['Main', 'Oak', 'Pine', 'Elm', 'Maple'][Math.floor(rng() * 5)]} ${['St', 'Ave', 'Blvd', 'Rd'][Math.floor(rng() * 4)]}`,
        city: cityList[Math.floor(rng() * cityList.length)],
        state: `State_${Math.floor(rng() * 50)}`,
        postalCode: String(10000 + Math.floor(rng() * 90000)),
        country,
      },
      rating: Math.round((1 + rng() * 4) * 10) / 10,
      reviewCount: Math.floor(rng() * 5000),
      tags: [
        `${types[i % types.length]}`,
        country.toLowerCase(),
        rng() > 0.5 ? 'popular' : 'local',
      ],
      hours: {
        open: `${7 + Math.floor(rng() * 4)}:00`,
        close: `${17 + Math.floor(rng() * 6)}:00`,
        timezone: ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney'][
          Math.floor(rng() * 4)
        ],
      },
      verified: rng() > 0.3,
    };
  });
}

/**
 * Warehouse inventory — enterprise ERP-style data.
 * Enum + numeric mix, supplier references.
 */
export function generateInventory(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const warehouses = ['WH-EAST', 'WH-WEST', 'WH-CENTRAL', 'WH-SOUTH', 'WH-EU', 'WH-APAC'];
  const categories = ['raw_material', 'component', 'finished_good', 'packaging', 'consumable'];
  const units = ['pcs', 'kg', 'liters', 'meters', 'boxes', 'pallets'];
  const statuses = ['in_stock', 'low_stock', 'out_of_stock', 'on_order', 'discontinued'];

  return Array.from({ length: count }, (_, i) => ({
    sku: `INV-${String(100000 + i).slice(1)}`,
    name: `Part ${i} - ${categories[i % categories.length]}`,
    category: categories[i % categories.length],
    warehouse: warehouses[i % warehouses.length],
    location: {
      aisle: `A${Math.floor(rng() * 50) + 1}`,
      rack: `R${Math.floor(rng() * 20) + 1}`,
      shelf: `S${Math.floor(rng() * 10) + 1}`,
      bin: `B${Math.floor(rng() * 100) + 1}`,
    },
    quantity: Math.floor(rng() * 10000),
    unit: units[Math.floor(rng() * units.length)],
    reorderLevel: Math.floor(rng() * 500),
    reorderQuantity: Math.floor(rng() * 2000),
    unitCost: Math.round((rng() * 500 + 0.5) * 100) / 100,
    totalValue: 0, // Calculated below
    supplier: {
      id: `SUP-${String(Math.floor(rng() * 200)).padStart(4, '0')}`,
      name: `Supplier ${Math.floor(rng() * 200)}`,
      leadTime_days: 3 + Math.floor(rng() * 45),
      rating: Math.round((2 + rng() * 3) * 10) / 10,
    },
    status: statuses[Math.floor(rng() * statuses.length)],
    lastCounted: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    expiryDate:
      rng() > 0.6 ? `2026-${String(3 + Math.floor(rng() * 10)).padStart(2, '0')}-01` : null,
    lotNumber: rng() > 0.5 ? `LOT${Math.floor(rng() * 1e6)}` : null,
  }));
}

/**
 * CMS articles — long text + structured metadata.
 * Content management / publishing use case.
 */
export function generateContentCMS(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const categories = [
    'Technology',
    'Science',
    'Business',
    'Health',
    'Sports',
    'Entertainment',
    'Politics',
    'Education',
  ];
  const statuses = ['draft', 'review', 'published', 'archived', 'scheduled'];
  const locales = ['en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE', 'ja-JP'];

  return Array.from({ length: count }, (_, i) => ({
    articleId: `art_${String(i).padStart(6, '0')}`,
    slug: `article-${i}-${categories[i % categories.length].toLowerCase()}-topic`,
    title: `${categories[i % categories.length]} Article #${i}: Exploring New Frontiers`,
    subtitle:
      rng() > 0.4
        ? `A deep dive into ${categories[i % categories.length].toLowerCase()} trends for 2026`
        : null,
    body: `# Introduction\n\n${'This is a comprehensive article about the latest developments. '.repeat(5 + Math.floor(rng() * 10))}\n\n## Key Findings\n\n${'Our research indicates significant progress in the field. '.repeat(3 + Math.floor(rng() * 7))}\n\n## Conclusion\n\n${'In summary, the evidence suggests continued growth and innovation. '.repeat(2 + Math.floor(rng() * 4))}`,
    author: {
      id: `author_${Math.floor(rng() * 100)}`,
      name: `Author ${Math.floor(rng() * 100)}`,
      bio: `Senior writer covering ${categories[i % categories.length].toLowerCase()}.`,
      avatar: `https://avatars.example.com/${Math.floor(rng() * 1000)}.jpg`,
    },
    category: categories[i % categories.length],
    tags: Array.from(
      { length: 2 + Math.floor(rng() * 4) },
      (_, t) => `tag_${Math.floor(rng() * 50)}`,
    ),
    status: statuses[Math.floor(rng() * statuses.length)],
    locale: locales[Math.floor(rng() * locales.length)],
    seo: {
      metaTitle: `${categories[i % categories.length]} Article #${i} | Our Publication`,
      metaDescription: `Read about the latest ${categories[i % categories.length].toLowerCase()} developments and insights.`,
      canonical: `https://example.com/articles/article-${i}`,
      ogImage: `https://images.example.com/og/article-${i}.jpg`,
    },
    publishedAt:
      rng() > 0.3
        ? `2026-01-${String((i % 28) + 1).padStart(2, '0')}T${String(Math.floor(rng() * 24)).padStart(2, '0')}:00:00Z`
        : null,
    wordCount: 200 + Math.floor(rng() * 3000),
    readTime_min: 1 + Math.floor(rng() * 15),
    views: Math.floor(rng() * 100000),
    featured: rng() > 0.85,
  }));
}

/**
 * Multi-lingual translation data — Unicode-heavy, tests tokenizer edge cases.
 * i18n / localization use case.
 */
export function generateMultiLingual(count: number, seed = DEFAULT_SEED) {
  const rng = seededRandom(seed);
  const locales = ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ko', 'ar', 'hi', 'pt'];
  const sampleTexts: Record<string, string[]> = {
    en: [
      'Hello World',
      'Welcome back',
      'Settings',
      'Save changes',
      'Sign out',
      'Dashboard',
      'Profile',
      'Notifications',
    ],
    es: [
      'Hola Mundo',
      'Bienvenido de nuevo',
      'Configuración',
      'Guardar cambios',
      'Cerrar sesión',
      'Panel',
      'Perfil',
      'Notificaciones',
    ],
    fr: [
      'Bonjour le monde',
      'Bienvenue',
      'Paramètres',
      'Enregistrer',
      'Déconnexion',
      'Tableau de bord',
      'Profil',
      'Notifications',
    ],
    de: [
      'Hallo Welt',
      'Willkommen zurück',
      'Einstellungen',
      'Änderungen speichern',
      'Abmelden',
      'Dashboard',
      'Profil',
      'Benachrichtigungen',
    ],
    ja: [
      'こんにちは世界',
      'おかえりなさい',
      '設定',
      '変更を保存',
      'サインアウト',
      'ダッシュボード',
      'プロフィール',
      '通知',
    ],
    zh: ['你好世界', '欢迎回来', '设置', '保存更改', '退出登录', '仪表盘', '个人资料', '通知'],
    ko: [
      '안녕하세요 세계',
      '다시 오신 것을 환영합니다',
      '설정',
      '변경 사항 저장',
      '로그아웃',
      '대시보드',
      '프로필',
      '알림',
    ],
    ar: [
      'مرحبا بالعالم',
      'مرحبا بعودتك',
      'الإعدادات',
      'حفظ التغييرات',
      'تسجيل الخروج',
      'لوحة القيادة',
      'الملف الشخصي',
      'الإشعارات',
    ],
    hi: [
      'नमस्ते दुनिया',
      'वापस स्वागत है',
      'सेटिंग्स',
      'परिवर्तन सहेजें',
      'साइन आउट',
      'डैशबोर्ड',
      'प्रोफ़ाइल',
      'सूचनाएं',
    ],
    pt: [
      'Olá Mundo',
      'Bem-vindo de volta',
      'Configurações',
      'Salvar alterações',
      'Sair',
      'Painel',
      'Perfil',
      'Notificações',
    ],
  };

  return Array.from({ length: count }, (_, i) => {
    const keyIndex = i % 8;
    const translations: Record<string, string> = {};
    const numLocales = 3 + Math.floor(rng() * (locales.length - 3));
    const selectedLocales = locales.slice(0, numLocales);
    for (const loc of selectedLocales) {
      translations[loc] = (sampleTexts[loc] || sampleTexts['en'])[keyIndex];
    }
    return {
      key: `ui.${['nav', 'auth', 'settings', 'dashboard', 'common'][Math.floor(rng() * 5)]}.${['title', 'label', 'button', 'placeholder', 'tooltip'][Math.floor(rng() * 5)]}_${i}`,
      namespace: ['common', 'auth', 'dashboard', 'settings', 'notifications'][
        Math.floor(rng() * 5)
      ],
      defaultValue: sampleTexts['en'][keyIndex],
      translations,
      context:
        rng() > 0.6
          ? `Used in the ${['header', 'sidebar', 'main content', 'footer', 'modal'][Math.floor(rng() * 5)]}`
          : null,
      maxLength: rng() > 0.7 ? 20 + Math.floor(rng() * 80) : null,
      pluralizable: rng() > 0.8,
      lastModified: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      translationStatus: {
        complete: selectedLocales.length,
        total: locales.length,
        percentage: Math.round((selectedLocales.length / locales.length) * 100),
      },
    };
  });
}
