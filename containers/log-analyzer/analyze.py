#!/usr/bin/env python3
"""
Log Analysis Task
Simulates analyzing system logs for patterns and anomalies
"""

import os
import time
import random
import json
from datetime import datetime, timedelta
from collections import Counter

def generate_sample_logs(count=1000):
    """Generate sample log entries"""
    levels = ['INFO', 'WARN', 'ERROR', 'DEBUG']
    services = ['api', 'database', 'cache', 'auth', 'worker', 'scheduler']
    messages = {
        'INFO': ['Request processed', 'Cache hit', 'Connection established', 'Task completed'],
        'WARN': ['High memory usage', 'Slow query detected', 'Rate limit approaching', 'Retry attempt'],
        'ERROR': ['Connection failed', 'Timeout exceeded', 'Invalid credentials', 'Database error'],
        'DEBUG': ['Entering function', 'Cache miss', 'Query executed', 'Response received']
    }
    
    logs = []
    base_time = datetime.now() - timedelta(hours=1)
    
    for i in range(count):
        level = random.choice(levels)
        service = random.choice(services)
        message = random.choice(messages[level])
        
        logs.append({
            'timestamp': (base_time + timedelta(seconds=i * 3.6)).isoformat(),
            'level': level,
            'service': service,
            'message': message,
            'request_id': f'req_{random.randint(10000, 99999)}'
        })
    
    return logs

def analyze_logs(logs):
    """Analyze logs for patterns"""
    start_time = time.time()
    
    # Simulate processing
    time.sleep(random.uniform(0.5, 2.0))
    
    # Count by level
    level_counts = Counter(log['level'] for log in logs)
    
    # Count by service
    service_counts = Counter(log['service'] for log in logs)
    
    # Find error rate
    error_count = level_counts.get('ERROR', 0)
    error_rate = (error_count / len(logs)) * 100
    
    # Find peak time (simplified)
    timestamps = [datetime.fromisoformat(log['timestamp']) for log in logs]
    time_range = max(timestamps) - min(timestamps)
    
    # Detect anomalies (simplified)
    anomalies = []
    if error_rate > 5:
        anomalies.append(f"High error rate: {error_rate:.2f}%")
    if level_counts.get('WARN', 0) > len(logs) * 0.2:
        anomalies.append("Elevated warning count")
    
    processing_time = (time.time() - start_time) * 1000
    
    return {
        "status": "success",
        "task_type": "log-analysis",
        "logs_analyzed": len(logs),
        "processing_time_ms": round(processing_time, 2),
        "summary": {
            "time_range_minutes": round(time_range.total_seconds() / 60, 2),
            "error_rate_percent": round(error_rate, 2),
            "unique_services": len(service_counts),
        },
        "level_distribution": dict(level_counts),
        "service_distribution": dict(service_counts),
        "anomalies": anomalies,
        "recommendations": [
            "Review ERROR logs for service: " + service_counts.most_common(1)[0][0] if error_count > 0 else "No critical issues found"
        ],
        "timestamp": datetime.now().isoformat(),
        "node": os.environ.get("HOSTNAME", "unknown")
    }

def main():
    print("=" * 50)
    print("Log Analysis Task Started")
    print("=" * 50)
    
    try:
        log_count = random.randint(500, 2000)
        print(f"\nGenerating {log_count} sample log entries...")
        logs = generate_sample_logs(log_count)
        
        print("Analyzing logs...\n")
        result = analyze_logs(logs)
        
        print(f"Analysis complete in {result['processing_time_ms']}ms")
        print(f"\nSummary:")
        print(f"  Logs analyzed: {result['logs_analyzed']}")
        print(f"  Error rate: {result['summary']['error_rate_percent']}%")
        print(f"  Time range: {result['summary']['time_range_minutes']} minutes")
        
        print(f"\nLevel Distribution:")
        for level, count in result['level_distribution'].items():
            print(f"  {level}: {count}")
        
        if result['anomalies']:
            print(f"\n⚠️  Anomalies detected:")
            for anomaly in result['anomalies']:
                print(f"  - {anomaly}")
        
        print("\n" + "=" * 50)
        print(json.dumps(result, indent=2))
        print("=" * 50)
        
        return 0
        
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return 1

if __name__ == "__main__":
    exit(main())
