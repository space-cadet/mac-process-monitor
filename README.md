# MacOS Process Monitor

A lightweight monitoring tool for MacOS that tracks system processes and logs those consuming excessive CPU or memory resources.

## Features

- Monitor all running processes on MacOS
- Track CPU and memory usage for each process
- Set configurable thresholds for "excessive" resource usage
- Log processes that exceed thresholds
- Maintain timestamped logs for later analysis
- Run with minimal impact on system performance

## Installation

### Prerequisites

- Python 3.8 or higher
- MacOS 10.14 (Mojave) or newer

### Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/mac-process-monitor.git
cd mac-process-monitor
```

2. Set up a virtual environment:
```bash
python -m venv venv
source venv/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

## Usage

### Basic Usage

```bash
python -m procmon.cli start
```

### Configuration

Edit the config file at `config/config.yaml` to customize:
- CPU and memory thresholds
- Monitoring interval
- Log rotation settings
- Process whitelist/blacklist

## Project Structure

```
mac-process-monitor/
├── bin/                  # Command-line scripts
├── procmon/              # Main package
│   ├── collector.py      # Process data collection
│   ├── analyzer.py       # Threshold analysis
│   ├── logger.py         # Logging module
│   ├── config.py         # Configuration management
│   └── cli.py            # Command-line interface
├── tests/                # Unit tests
├── config/               # Configuration files
└── README.md             # Project documentation
```

## License

[MIT License](LICENSE)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
