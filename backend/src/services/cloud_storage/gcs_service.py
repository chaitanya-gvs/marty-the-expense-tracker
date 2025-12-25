"""
Google Cloud Storage Service

This service handles all interactions with Google Cloud Storage for storing
bank statements, unlocked PDFs, and extracted data.
"""

import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Union, BinaryIO

from google.cloud import storage
from google.cloud.exceptions import NotFound, GoogleCloudError

from src.utils.logger import get_logger
from src.utils.settings import get_settings

logger = get_logger(__name__)


class GoogleCloudStorageService:
    """Service for managing bank statements and related files in Google Cloud Storage"""
    
    def __init__(self, project_id: Optional[str] = None, bucket_name: Optional[str] = None):
        """
        Initialize the Google Cloud Storage service
        
        Args:
            project_id: Google Cloud project ID. If None, uses settings
            bucket_name: GCS bucket name. If None, uses settings
        """
        self.settings = get_settings()
        self.project_id = project_id or self.settings.GOOGLE_CLOUD_PROJECT_ID
        self.bucket_name = bucket_name or self.settings.GOOGLE_CLOUD_BUCKET_NAME
        
        if not self.project_id:
            raise ValueError("Google Cloud project ID is required")
        if not self.bucket_name:
            raise ValueError("Google Cloud bucket name is required")
        
        # Set up credentials path if provided
        if self.settings.GOOGLE_APPLICATION_CREDENTIALS:
            creds_path = Path(self.settings.GOOGLE_APPLICATION_CREDENTIALS)
            if not creds_path.is_absolute():
                # Convert relative path to absolute path relative to backend directory
                backend_path = Path(__file__).parent.parent.parent.parent
                creds_path = backend_path / creds_path
            os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = str(creds_path)
            logger.info(f"Set GOOGLE_APPLICATION_CREDENTIALS to: {creds_path}")
        
        # Initialize the client
        try:
            self.client = storage.Client(project=self.project_id)
            self.bucket = self.client.bucket(self.bucket_name)
            logger.info(f"Initialized GCS service for bucket: {self.bucket_name}")
        except Exception as e:
            logger.error("Failed to initialize GCS client", exc_info=True)
            raise
    
    def upload_file(
        self, 
        local_file_path: Union[str, Path], 
        cloud_path: str,
        content_type: Optional[str] = None,
        metadata: Optional[Dict[str, str]] = None
    ) -> Dict[str, any]:
        """
        Upload a file to Google Cloud Storage
        
        Args:
            local_file_path: Path to the local file to upload
            cloud_path: Path in the bucket where the file should be stored
            content_type: MIME type of the file
            metadata: Additional metadata to store with the file
            
        Returns:
            Dictionary with upload result information
        """
        try:
            local_path = Path(local_file_path)
            if not local_path.exists():
                return {"success": False, "error": f"Local file not found: {local_path}"}
            
            # Create blob
            blob = self.bucket.blob(cloud_path)
            
            # Set content type if provided
            if content_type:
                blob.content_type = content_type
            
            # Set metadata if provided
            if metadata:
                blob.metadata = metadata
            
            # Upload the file
            blob.upload_from_filename(str(local_path))
            
            logger.info(f"Successfully uploaded {local_path.name} to {cloud_path}")
            return {
                "success": True,
                "cloud_path": cloud_path,
                "size": local_path.stat().st_size,
                "etag": blob.etag
            }
            
        except Exception as e:
            logger.error(f"Failed to upload file {local_file_path}", exc_info=True)
            return {"success": False, "error": str(e)}
    
    def download_file(
        self, 
        cloud_path: str, 
        local_file_path: Union[str, Path]
    ) -> Dict[str, any]:
        """
        Download a file from Google Cloud Storage
        
        Args:
            cloud_path: Path of the file in the bucket
            local_file_path: Local path where the file should be saved
            
        Returns:
            Dictionary with download result information
        """
        try:
            blob = self.bucket.blob(cloud_path)
            
            if not blob.exists():
                return {"success": False, "error": f"File not found in bucket: {cloud_path}"}
            
            local_path = Path(local_file_path)
            local_path.parent.mkdir(parents=True, exist_ok=True)
            
            blob.download_to_filename(str(local_path))
            
            logger.info(f"Successfully downloaded {cloud_path} to {local_path}")
            return {
                "success": True,
                "local_path": str(local_path),
                "size": local_path.stat().st_size
            }
            
        except Exception as e:
            logger.error(f"Failed to download file {cloud_path}", exc_info=True)
            return {"success": False, "error": str(e)}
    
    def download_to_temp_file(self, cloud_path: str) -> Dict[str, any]:
        """
        Download a file from GCS to a temporary file
        
        Args:
            cloud_path: Path of the file in the bucket
            
        Returns:
            Dictionary with temp file path and cleanup function
        """
        try:
            blob = self.bucket.blob(cloud_path)
            
            if not blob.exists():
                return {"success": False, "error": f"File not found in bucket: {cloud_path}"}
            
            # Create temporary file
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=Path(cloud_path).suffix)
            temp_path = Path(temp_file.name)
            temp_file.close()
            
            blob.download_to_filename(str(temp_path))
            
            logger.info(f"Downloaded {cloud_path} to temporary file: {temp_path}")
            return {
                "success": True,
                "temp_path": str(temp_path),
                "size": temp_path.stat().st_size,
                "cleanup": lambda: temp_path.unlink(missing_ok=True)
            }
            
        except Exception as e:
            logger.error(f"Failed to download file {cloud_path} to temp", exc_info=True)
            return {"success": False, "error": str(e)}
    
    def list_files(self, prefix: str = "", max_results: int = 1000) -> List[Dict[str, any]]:
        """
        List files in the bucket with optional prefix filter
        
        Args:
            prefix: Prefix to filter files (e.g., "locked-statements/axis-bank/")
            max_results: Maximum number of results to return
            
        Returns:
            List of file information dictionaries
        """
        try:
            blobs = self.client.list_blobs(self.bucket_name, prefix=prefix, max_results=max_results)
            
            files = []
            for blob in blobs:
                files.append({
                    "name": blob.name,
                    "size": blob.size,
                    "created": blob.time_created,
                    "updated": blob.updated,
                    "content_type": blob.content_type,
                    "etag": blob.etag
                })
            
            logger.info(f"Listed {len(files)} files with prefix: {prefix}")
            return files
            
        except Exception as e:
            logger.error(f"Failed to list files with prefix {prefix}", exc_info=True)
            return []
    
    def delete_file(self, cloud_path: str) -> Dict[str, any]:
        """
        Delete a file from Google Cloud Storage
        
        Args:
            cloud_path: Path of the file in the bucket to delete
            
        Returns:
            Dictionary with deletion result
        """
        try:
            blob = self.bucket.blob(cloud_path)
            
            if not blob.exists():
                return {"success": False, "error": f"File not found: {cloud_path}"}
            
            blob.delete()
            logger.info(f"Successfully deleted file: {cloud_path}")
            return {"success": True}
            
        except Exception as e:
            logger.error(f"Failed to delete file {cloud_path}", exc_info=True)
            return {"success": False, "error": str(e)}
    
    def file_exists(self, cloud_path: str) -> bool:
        """
        Check if a file exists in the bucket
        
        Args:
            cloud_path: Path of the file in the bucket
            
        Returns:
            True if file exists, False otherwise
        """
        try:
            blob = self.bucket.blob(cloud_path)
            return blob.exists()
        except Exception as e:
            logger.error(f"Error checking file existence {cloud_path}", exc_info=True)
            return False
    
    def get_file_info(self, cloud_path: str) -> Dict[str, any]:
        """
        Get information about a file in the bucket
        
        Args:
            cloud_path: Path of the file in the bucket
            
        Returns:
            Dictionary with file information
        """
        try:
            blob = self.bucket.blob(cloud_path)
            
            if not blob.exists():
                return {"success": False, "error": f"File not found: {cloud_path}"}
            
            blob.reload()  # Ensure we have the latest metadata
            
            return {
                "success": True,
                "name": blob.name,
                "size": blob.size,
                "created": blob.time_created,
                "updated": blob.updated,
                "content_type": blob.content_type,
                "etag": blob.etag,
                "metadata": blob.metadata or {}
            }
            
        except Exception as e:
            logger.error(f"Failed to get file info for {cloud_path}", exc_info=True)
            return {"success": False, "error": str(e)}
    
    # Convenience methods for bank statement organization
    
    def upload_unlocked_statement(
        self, 
        local_file_path: Union[str, Path], 
        month_year: str, 
        filename: Optional[str] = None
    ) -> Dict[str, any]:
        """Upload an unlocked statement to the appropriate month/year folder"""
        if filename is None:
            filename = Path(local_file_path).name
        
        cloud_path = f"unlocked-statements/{month_year}/{filename}"
        return self.upload_file(local_file_path, cloud_path, content_type="application/pdf")
    
    def list_month_files(self, month_year: str) -> List[Dict[str, any]]:
        """
        List unlocked statement files for a specific month/year
        
        Args:
            month_year: Month and year in format "YYYY-MM" (e.g., "2025-09")
            
        Returns:
            List of file information dictionaries
        """
        prefix = f"unlocked-statements/{month_year}/"
        return self.list_files(prefix=prefix)
    
    def list_all_unlocked_statements(self) -> List[Dict[str, any]]:
        """
        List all unlocked statement files
        
        Returns:
            List of file information dictionaries
        """
        prefix = "unlocked-statements/"
        return self.list_files(prefix=prefix)
