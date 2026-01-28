#!/bin/bash
# Script to start/stop Cloud SQL instance for cost savings
# Usage: ./manage_cloud_sql_instance.sh [start|stop|status]

set -e

INSTANCE_NAME="${CLOUD_SQL_INSTANCE_NAME:-expense-tracker-db}"
PROJECT_ID="${GCP_PROJECT_ID:-expense-tracker-470706}"

# Set the project if not already set
gcloud config set project "$PROJECT_ID" 2>/dev/null || true

case "$1" in
  start)
    echo "🚀 Starting Cloud SQL instance..."
    gcloud sql instances patch $INSTANCE_NAME --activation-policy=ALWAYS --quiet
    echo "✅ Instance is starting (may take 1-2 minutes)"
    echo "   Check status: gcloud sql instances describe $INSTANCE_NAME --format='value(state)'"
    ;;
  stop)
    echo "🛑 Stopping Cloud SQL instance..."
    gcloud sql instances patch $INSTANCE_NAME --activation-policy=NEVER --quiet
    echo "✅ Instance is stopping (may take 1-2 minutes)"
    echo "   Note: You'll still be charged for storage while stopped"
    ;;
  status)
    echo "📊 Cloud SQL Instance Status:"
    gcloud sql instances describe $INSTANCE_NAME --format="table(state,settings.activationPolicy,settings.dataDiskSizeGb)"
    ;;
  *)
    echo "Usage: $0 [start|stop|status]"
    echo ""
    echo "Commands:"
    echo "  start  - Start the Cloud SQL instance"
    echo "  stop   - Stop the Cloud SQL instance (saves compute costs)"
    echo "  status - Check current instance status"
    exit 1
    ;;
esac

