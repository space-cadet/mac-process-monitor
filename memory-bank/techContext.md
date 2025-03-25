# Technical Context: MacOS Process Monitor

## Technology Stack

### Core Language and Runtime
- **Python 3.8+**: Chosen for cross-version compatibility, rich ecosystem, and development speed
- **Standard Library**: Leveraging built-in modules to minimize dependencies
- **Future Consideration**: Architecture designed to allow future Go or Rust implementation

### System Interaction
- **psutil**: Cross-platform library for retrieving process and system utilization information
- **subprocess**: Used for executing and processing shell commands when necessary
- **PyObjC** (optional): For deeper MacOS integration when standard libraries are insufficient

### Configuration
- **PyYAML**: For YAML configuration file management
- **argparse**: For command-line argument parsing

### Logging
- **logging**: Python's built-in logging facility
- **logging.handlers.RotatingFileHandler**: For log rotation and management

### User Interfaces
- **CLI**: Command-line interface using argparse
- **GUI** (future): 
  - PyQt/PySide (primary consideration for desktop GUI)
  - Tkinter (alternative, simpler option)
- **Web Interface** (future):
  - Flask/FastAPI for backend API
  - HTML/CSS/JavaScript for frontend
  - WebSockets for real-time updates

## Development Environment

### Required Tools
- Python 3.8+ installed on MacOS
- pip for package management
- Virtual environment (venv or conda) for dependency isolation

### Development Setup
```bash
# Create and activate virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Testing
- **unittest**: Python's built-in testing framework
- **pytest**: For more advanced testing capabilities

## Technical Constraints

### System Compatibility
- **MacOS Versions**: Targeting MacOS 10.14 (Mojave) and newer
- **Python Version**: Must work with Python 3.8+

### Performance Requirements
- Monitoring overhead must be less than 1% CPU usage
- Memory footprint should be under 50MB
- Log file growth rate must be manageable with rotation

### Permission Requirements
- Requires user-level permissions for accessing process information
- Some advanced features may require elevated permissions

## Dependencies

### Core Dependencies
- **psutil**: ^5.8.0 - Process and system utilities
- **PyYAML**: ^6.0 - For YAML configuration

### Optional Dependencies
- **PyObjC**: ^7.3 - For deeper MacOS integration
- **PyQt5/PySide6**: For GUI implementation (future)
- **Flask/FastAPI**: For web API (future)

### Development Dependencies
- **pytest**: ^7.0.0 - Testing framework
- **black**: ^22.1.0 - Code formatting
- **pylint**: ^2.12.2 - Static code analysis

## Deployment Strategy

### Installation Methods
- Manual installation from source
- pip installation (future)
- Homebrew formula (potential future)

### Packaging
- setuptools for creating distributable packages
- Requirements.txt for dependency management

## File Structure
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
│   └── procmon             # Command-line entry point
├── config/                 # Configuration files
│   └── default_config.yaml # Default configuration
├── web/                    # Web interface files (future)
│   ├── static/             # Static web assets 
│   └── templates/          # HTML templates
├── tests/                  # Test suite
│   ├── test_collector.py
│   ├── test_analyzer.py
│   └── test_logger.py
├── docs/                   # Additional documentation
├── README.md
├── setup.py
└── requirements.txt
```

## Additional Notes

### System APIs Used
- The tool primarily uses psutil, which in turn uses low-level MacOS APIs
- For obtaining process information: sysctl, proc_listpids, proc_pidinfo
- For memory information: vm_statistics, task_info
- For CPU usage: host_processor_info, task_thread_info

### Future Language Migration Considerations
- Core functionality designed with language-agnostic principles
- Simple data structures for easy translation to Go or Rust
- Clear component interfaces to allow gradual replacement
- Protocol-based communication between components

### Interface Implementation Strategy
- CLI implementation first for core functionality
- GUI implementation with PyQt/PySide (most likely choice)
- Web interface with Flask/FastAPI backend and JavaScript frontend
- Shared core functionality across all interfaces
