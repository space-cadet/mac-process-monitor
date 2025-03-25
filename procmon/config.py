"""
Configuration management for the MacOS Process Monitor.
"""

import os
import yaml
from pathlib import Path


class ConfigManager:
    """
    Manages configuration for the process monitor.
    Loads defaults and user configuration, merges them, and provides access.
    """

    def __init__(self, config_path=None):
        """
        Initialize the configuration manager.
        
        Args:
            config_path (str, optional): Path to user configuration file.
                If None, only default configuration is used.
        """
        self.default_config_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            'config', 'default_config.yaml'
        )
        self.user_config_path = config_path
        self.config = self._load_config()

    def _load_config(self):
        """
        Load and merge configuration from default and user files.
        
        Returns:
            dict: Merged configuration dictionary.
        """
        # Load default configuration
        default_config = self._load_yaml(self.default_config_path)
        
        # Load user configuration if provided
        user_config = {}
        if self.user_config_path and os.path.exists(self.user_config_path):
            user_config = self._load_yaml(self.user_config_path)
        
        # Merge configurations, with user config taking precedence
        merged_config = self._merge_configs(default_config, user_config)
        
        # Process paths and other special values
        self._process_config(merged_config)
        
        return merged_config

    def _load_yaml(self, file_path):
        """
        Load YAML configuration from file.
        
        Args:
            file_path (str): Path to YAML configuration file.
            
        Returns:
            dict: Configuration dictionary, or empty dict if file not found.
        """
        try:
            with open(file_path, 'r') as f:
                return yaml.safe_load(f) or {}
        except (yaml.YAMLError, FileNotFoundError) as e:
            print(f"Error loading configuration from {file_path}: {e}")
            return {}

    def _merge_configs(self, default_config, user_config):
        """
        Recursively merge default and user configurations.
        
        Args:
            default_config (dict): Default configuration dictionary.
            user_config (dict): User configuration dictionary.
            
        Returns:
            dict: Merged configuration dictionary.
        """
        merged = default_config.copy()
        
        for key, value in user_config.items():
            # If both dicts have the same key and both values are dicts, merge them
            if (key in merged and isinstance(merged[key], dict) 
                    and isinstance(value, dict)):
                merged[key] = self._merge_configs(merged[key], value)
            else:
                # Otherwise, user config overrides default
                merged[key] = value
                
        return merged

    def _process_config(self, config):
        """
        Process special configuration values like paths.
        
        Args:
            config (dict): Configuration dictionary to process.
        """
        # Expand user home directory in log directory path
        if 'logging' in config and 'directory' in config['logging']:
            config['logging']['directory'] = os.path.expanduser(
                config['logging']['directory']
            )
            
            # Ensure log directory exists
            log_dir = Path(config['logging']['directory'])
            log_dir.mkdir(parents=True, exist_ok=True)

    def get(self, *keys, default=None):
        """
        Get a configuration value by key path.
        
        Args:
            *keys: Sequence of keys to traverse the configuration.
            default: Value to return if the key path doesn't exist.
            
        Returns:
            The configuration value, or default if not found.
        """
        current = self.config
        for key in keys:
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                return default
        return current

    def save_user_config(self, config_dict, config_path=None):
        """
        Save a user configuration to a file.
        
        Args:
            config_dict (dict): Configuration dictionary to save.
            config_path (str, optional): Path to save to. If None, uses the 
                current user_config_path.
                
        Returns:
            bool: True if saved successfully, False otherwise.
        """
        save_path = config_path or self.user_config_path
        if not save_path: