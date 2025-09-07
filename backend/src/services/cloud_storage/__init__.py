"""
Cloud Storage Services

This module provides services for interacting with Google Cloud Storage
for storing and managing bank statements and related documents.
"""

from .gcs_service import GoogleCloudStorageService

__all__ = ["GoogleCloudStorageService"]
