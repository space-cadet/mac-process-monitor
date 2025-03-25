# System Patterns: MacOS Process Monitor

## System Architecture
The MacOS Process Monitor follows a modular architecture with clear separation of concerns to support multiple interfaces and potential future language implementations:

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│                 │      │                 │      │                 │
│  Process Data   │─────▶│  Threshold      │─────▶│  Logger         │
│  Collector      │      │  Analyzer       │      │  Module         │
│                 │      │                 │      │                 │
└─────────────────┘      └─────────────────┘      └─────────────────┘
        ▲                        ▲                        ▲
        │                        │                        │
        │                        │                        │
        │                        │                        │
        ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│                      Configuration Manager                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                 ▲
                                 │
                                 ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│               │      │               │      │               │
│  CLI          │      │  GUI          │      │  Web API      │
│  Interface    │      │  Interface    │      │  Server       │
│               │      │               │      │               │
└───────────────┘      └───────────────┘      └───────────────┘
```

## Key Components

### Process Data Collector
- Periodically samples process information using native MacOS APIs via psutil
- Collects CPU usage, memory usage, and process metadata
- Filters processes based on configuration settings
- Implements efficient sampling to minimize performance impact

### Threshold Analyzer
- Compares collected process data against configurable thresholds
- Identifies processes exceeding CPU or memory thresholds
- Supports different threshold types (absolute, percentage, duration-based)
- Maintains short-term history for pattern detection

### Logger Module
- Creates and maintains log files with standardized formats
- Implements log rotation to manage disk usage
- Provides different log levels (info, warning, error)
- Supports querying of historical log data

### Configuration Manager
- Loads and validates user configuration
- Provides defaults for unconfigured options
- Persists configuration changes
- Handles configuration file versioning and updates

### User Interfaces
- **CLI Interface**: Command-line for configuration and monitoring
- **GUI Interface**: Desktop application for visual monitoring (future)
- **Web Interface**: Browser-based monitoring over local network (future)

## Project Structure
```
mac-process-monitor/
├── procmon/                # Core package
│   ├── core/               # Core functionality (language-agnostic design)
│   │   ├── collector.py    # Process data collection
│   │   ├── analyzer.py     # Threshold analysis
│   │   └── logger.py       # Logging system
│   ├── config/             # Configuration management
│   │   └── manager.py      # Config operations
│   ├── interfaces/         # Interface implementations
│   │   ├── cli.py          # Command-line interface
│   │   ├── gui.py          # GUI interface (future)
│   │   └── api.py          # Web API (future)
│   └── utils/              # Utility functions
├── bin/                    # Executable scripts
├── config/                 # Configuration files
├── web/                    # Web interface files (future)
├── tests/                  # Test suite
└── memory-bank/            # Project documentation
```

## Design Patterns

### Observer Pattern
- Configuration changes trigger updates to dependent components
- Process data collection notifies threshold analyzer of new data

### Repository Pattern
- Abstracts storage and retrieval of log data
- Provides consistent interface regardless of storage backend

### Strategy Pattern
- Pluggable threshold strategies for different resource types
- Configurable logging strategies

### Façade Pattern
- Simple interface for starting/stopping monitoring
- Hides complexity of underlying components

### Factory Pattern
- Used for creating interface components based on configuration

## Data Flow
1. Process Collector gathers system data at configured intervals
2. Collected data is passed to Threshold Analyzer
3. If thresholds are exceeded, relevant process data is sent to Logger
4. Logger formats and writes data to log files
5. User Interfaces can query logs and update configuration

## Technical Decisions

### Language and Framework
- Initial implementation in Python with psutil
- Designed with future migration to Go or Rust in mind
- Core functionality uses language-agnostic patterns

### Interface Implementation
- Multiple interfaces sharing the same core functionality
- CLI for immediate functionality
- Future GUI using PyQt/PySide or Tkinter
- Future web interface with Python backend and HTML/JS frontend

### Polling vs Event-Based Monitoring
The system uses polling at configurable intervals rather than event-based monitoring. This approach:
- Provides predictable system load
- Simplifies implementation
- Enables easier customization of monitoring frequency

### Future Language Migration Strategy
To facilitate future migration to Go or Rust:
1. Use simple data structures (dicts, lists, primitives)
2. Define clear interfaces between components
3. Document component behavior thoroughly
4. Avoid Python-specific idioms where possible
5. Implement a shared message protocol for cross-language communication
