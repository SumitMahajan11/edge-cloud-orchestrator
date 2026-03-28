#!/usr/bin/env node
/**
 * Data Aggregation Task
 * Simulates aggregating data from multiple sources
 */

const os = require('os');

function generateRandomData(count) {
    const data = [];
    const categories = ['sales', 'users', 'orders', 'clicks', 'views'];
    
    for (let i = 0; i < count; i++) {
        data.push({
            id: i + 1,
            category: categories[Math.floor(Math.random() * categories.length)],
            value: Math.floor(Math.random() * 10000),
            timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString()
        });
    }
    
    return data;
}

function aggregateData(data) {
    const startTime = Date.now();
    
    // Simulate processing delay
    const processingTime = 500 + Math.random() * 2000;
    
    return new Promise((resolve) => {
        setTimeout(() => {
            // Group by category
            const byCategory = {};
            data.forEach(item => {
                if (!byCategory[item.category]) {
                    byCategory[item.category] = { count: 0, total: 0, avg: 0 };
                }
                byCategory[item.category].count++;
                byCategory[item.category].total += item.value;
            });
            
            // Calculate averages
            Object.keys(byCategory).forEach(cat => {
                byCategory[cat].avg = Math.round(byCategory[cat].total / byCategory[cat].count);
            });
            
            const result = {
                status: 'success',
                task_type: 'data-aggregation',
                records_processed: data.length,
                processing_time_ms: Date.now() - startTime,
                aggregation: byCategory,
                summary: {
                    total_records: data.length,
                    unique_categories: Object.keys(byCategory).length,
                    grand_total: Object.values(byCategory).reduce((sum, cat) => sum + cat.total, 0)
                },
                timestamp: new Date().toISOString(),
                node: os.hostname()
            };
            
            resolve(result);
        }, processingTime);
    });
}

async function main() {
    console.log('='.repeat(50));
    console.log('Data Aggregation Task Started');
    console.log('='.repeat(50));
    
    try {
        // Generate sample data
        const recordCount = Math.floor(Math.random() * 500) + 100;
        console.log(`\nGenerating ${recordCount} sample records...`);
        
        const data = generateRandomData(recordCount);
        
        console.log('Processing aggregation...\n');
        const result = await aggregateData(data);
        
        console.log(`Processed ${result.records_processed} records in ${result.processing_time_ms}ms`);
        console.log('\nAggregation Results:');
        
        Object.entries(result.aggregation).forEach(([category, stats]) => {
            console.log(`  ${category}:`);
            console.log(`    Count: ${stats.count}`);
            console.log(`    Total: ${stats.total}`);
            console.log(`    Average: ${stats.avg}`);
        });
        
        console.log('\n' + '='.repeat(50));
        console.log(JSON.stringify(result, null, 2));
        console.log('='.repeat(50));
        
        process.exit(0);
        
    } catch (error) {
        console.error('ERROR:', error.message);
        process.exit(1);
    }
}

main();
