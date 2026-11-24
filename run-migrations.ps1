# Run Supabase Migrations Script
# This script reads all migration files and executes them via Supabase SQL API

# Configuration - UPDATE THESE VALUES
$SUPABASE_PROJECT_URL = "https://your-project.supabase.co"  # Your project URL
$SUPABASE_SERVICE_KEY = "your-service-role-key-here"  # Your service role key (from Supabase dashboard)

# Get all migration files in order
$migrationFiles = Get-ChildItem -Path "supabase/migrations" -Filter "*.sql" | Sort-Object Name

Write-Host "Found $($migrationFiles.Count) migration files" -ForegroundColor Green

foreach ($file in $migrationFiles) {
    Write-Host "`nProcessing: $($file.Name)" -ForegroundColor Cyan
    
    # Read migration content
    $sqlContent = Get-Content -Path $file.FullName -Raw
    
    # Prepare API request
    $headers = @{
        "apikey" = $SUPABASE_SERVICE_KEY
        "Authorization" = "Bearer $SUPABASE_SERVICE_KEY"
        "Content-Type" = "application/json"
    }
    
    $body = @{
        query = $sqlContent
    } | ConvertTo-Json
    
    try {
        # Execute migration via REST API
        $response = Invoke-RestMethod -Uri "$SUPABASE_PROJECT_URL/rest/v1/rpc/exec_sql" -Method Post -Headers $headers -Body $body
        Write-Host "✓ Success: $($file.Name)" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ Error in $($file.Name): $($_.Exception.Message)" -ForegroundColor Red
        
        # Ask user if they want to continue
        $continue = Read-Host "Continue with next migration? (y/n)"
        if ($continue -ne "y") {
            Write-Host "Migration stopped." -ForegroundColor Yellow
            exit 1
        }
    }
}

Write-Host "`n✓ All migrations processed!" -ForegroundColor Green
