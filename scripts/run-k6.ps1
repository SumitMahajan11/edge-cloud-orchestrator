# Run k6 load tests
$K6_DIR = "tests/k6"
$RESULTS_DIR = "tests/k6/results"

if (-not (Test-Path $RESULTS_DIR)) {
    New-Item -ItemType Directory -Path $RESULTS_DIR | Out-Null
}

$tests = Get-ChildItem -Path $K6_DIR -Filter *.js

foreach ($test in $tests) {
    Write-Host "Running k6 test: $($test.Name)..." -ForegroundColor Cyan
    $outputFile = Join-Path $RESULTS_DIR "$($test.BaseName)_result.json"
    
    # Check if k6 is installed
    if (Get-Command k6 -ErrorAction SilentlyContinue) {
        k6 run --summary-export $outputFile $test.FullName
    } else {
        Write-Error "k6 not found. Please install k6: https://k6.io/docs/getting-started/installation/"
        exit 1
    }
}
