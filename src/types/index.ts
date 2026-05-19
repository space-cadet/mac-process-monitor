// Battery sample - single point-in-time measurement
export interface BatterySample {
  timestamp: number;        // Unix epoch ms
  percent: number;          // 0-100
  isCharging: boolean;
  isPlugged: boolean;
  timeRemaining: number | null;  // minutes (null if charging)
  cycleCount: number | null;
  temperature: number | null;    // °C if available
}

// Process snapshot - CPU/memory for one process
export interface ProcessSnapshot {
  pid: number;
  name: string;
  cpuPercent: number;       // total CPU %
  cpuUserPercent: number;   // user-space CPU %
  cpuSystemPercent: number; // kernel-space CPU %
  memoryPercent: number;
  rssMB: number;
  vmsMB: number;
  nice: number;             // process priority/nice value
  state: string;            // running, sleeping, etc.
  cmdline: string;
}

// System snapshot - everything at one timestamp
export interface SystemSnapshot {
  timestamp: number;
  battery: BatterySample;
  processes: ProcessSnapshot[];
  // CPU breakdown
  cpuTotal: number;         // aggregate CPU %
  cpuUser: number;          // user-space aggregate %
  cpuSystem: number;        // kernel-space aggregate %
  cpuIdle: number;          // idle %
  // Memory breakdown
  memoryTotal: number;      // aggregate memory %
  memoryUsedMB: number;     // absolute used memory
  memoryFreeMB: number;     // absolute free memory
  swapUsedMB: number;
  swapTotalMB: number;
  // Load
  loadAvg: number;          // 1-minute load average (from currentLoad.avgLoad)
  // Disk I/O (system-level cumulative counters)
  diskReadIO: number | null;
  diskWriteIO: number | null;
  diskTotalIO: number | null;
  // Network I/O (system-level cumulative counters, first active interface)
  netRxBytes: number | null;
  netTxBytes: number | null;
  // Disk usage (primary mount)
  fsUsedPercent: number | null;
  // Thermal
  cpuTemp: number | null;
}

// Drain event - detected rapid battery drop
export interface DrainEvent {
  id: string;             // UUID
  startTime: number;
  endTime: number;
  startPercent: number;
  endPercent: number;
  drainRate: number;      // % per minute
  durationMinutes: number;
  topProcesses: ProcessSnapshot[];  // highest CPU during event
  wasCharging: boolean;
}

// Alert configuration
export interface AlertConfig {
  enabled: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  drainThreshold: number;     // % per minute to trigger alert
  minDuration: number;        // minutes of drain before alerting
  cooldownMinutes: number;    // minutes between alerts
}

// Monitor configuration
export interface MonitorConfig {
  sampleIntervalSeconds: number;   // how often to sample (default: 30)
  dbPath: string;
  retentionDays: number;
  alert: AlertConfig;
}