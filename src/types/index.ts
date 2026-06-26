export interface NetworkInterface {
  iface: string;
  ip4?: string;
  ip6?: string;
  mac?: string;
  operstate: string;
  rx_bytes: number;
  tx_bytes: number;
  rx_dropped: number;
  tx_dropped: number;
  rx_errors: number;
  tx_errors: number;
  speed?: number;
  duplex?: string;
}

export interface NetworkConnection {
  protocol: string;
  localAddress: string;
  localPort: string;
  peerAddress: string;
  peerPort: string;
  state: string;
  pid: number | null;
  processName: string | null;
}

export interface DiskVolume {
  fs: string;
  type: string;
  size: number;
  used: number;
  available: number;
  use: number;
  mount: string;
  rw: boolean | null;
}

export interface SystemInfo {
  platform: string;
  distro: string;
  release: string;
  arch: string;
  hostname: string;
  uptime: number;
  bootTime: number;
  cpuModel: string;
  cpuCores: number;
  cpuThreads: number;
}

// Battery sample - single point-in-time measurement
export interface BatterySample {
  timestamp: number;        // Unix epoch ms
  percent: number;          // 0-100
  isCharging: boolean;
  isPlugged: boolean;
  timeRemaining: number | null;  // minutes (null if charging)
  cycleCount: number | null;
  temperature: number | null;    // °C if available
  health: number | null;         // Battery health % (maxCapacity / designedCapacity * 100)
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
  energyMJ?: number | null;        // macOS energy impact score (from top POWER column)
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
  // Disk I/O rates (bytes/sec, delta-based)
  diskReadRate: number | null;
  diskWriteRate: number | null;
  // Network I/O (system-level cumulative counters, first active interface)
  netRxBytes: number | null;
  netTxBytes: number | null;
  // Network interfaces (all)
  networkInterfaces: NetworkInterface[];
  // Disk usage (primary mount)
  fsUsedPercent: number | null;
  // All disk volumes
  diskVolumes: DiskVolume[];
  // Thermal
  cpuTemp: number | null;
  // System info
  systemInfo: SystemInfo;
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

// ─── NEW: Spike Detection ───

export interface SpikeThresholds {
  cpuPercent: number;       // Absolute CPU % threshold (e.g., 50%)
  memoryPercent: number;    // Absolute memory % threshold
  cpuMultiplier: number;    // Multiplier above baseline (e.g., 3x)
  memoryMultiplier: number; // Multiplier above baseline
  minBaselineSamples: number; // Min samples before baseline is valid
  cooldownSeconds: number;  // Cooldown between spikes for same process
}

export interface ProcessSpike {
  id: string;
  timestamp: number;
  processName: string;
  pid: number;
  metricType: 'cpu' | 'memory';
  value: number;            // The spiked value
  baseline: number;       // Moving average baseline
  threshold: number;      // Threshold that was crossed
  snapshotId: number;     // Reference to snapshot
}

export interface SpikeConfig {
  enabled: boolean;
  thresholds: SpikeThresholds;
  watchedProcesses?: string[]; // If empty, watch all
  ignoredProcesses?: string[]; // Always ignore these
}

// ─── NEW: Battery Impact ───

export interface BatteryImpactEntry {
  processName: string;
  totalImpactScore: number;    // Cumulative CPU-seconds during drain
  drainTimeMinutes: number;    // Total time correlated with drain
  samplesDuringDrain: number;  // Number of samples included
  avgCpuDuringDrain: number;   // Average CPU % during drain periods
  lastSeenTimestamp: number;
  firstSeenTimestamp: number;
}

export interface BatteryImpactEvent {
  id: string;
  startTime: number;
  endTime: number;
  durationMinutes: number;
  batteryDropPercent: number;
  processImpacts: ProcessImpact[];
}

export interface ProcessImpact {
  processName: string;
  pid: number;
  cpuSeconds: number;      // CPU% × duration
  avgCpuPercent: number;
  avgMemoryPercent: number;
  samples: number;
  impactScore: number;     // Normalized score for this event
}

export interface BatteryImpactConfig {
  enabled: boolean;
  analysisWindowMinutes: number;   // How long a drain period to analyze
  minBatteryDropPercent: number;    // Minimum battery drop to count as drain
  minDurationMinutes: number;       // Minimum duration to count
  scoreDecayHours: number;          // How often to decay old scores (optional)
}

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
  retentionSizeMB: number;         // max DB size before cleanup (default: 400)
  logProcesses: boolean;           // store process samples
  logBattery: boolean;             // store battery data
  logSpikes: boolean;              // detect and store spikes
  logBatteryImpact: boolean;       // track battery impact per process
  alert: AlertConfig;
  spike: SpikeConfig;
  batteryImpact: BatteryImpactConfig;
}