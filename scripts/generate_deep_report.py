import os
import subprocess
import json
from selenium import webdriver
import base64
import time
from datetime import datetime

# Map test function names to human-readable descriptions
TEST_DESCRIPTIONS = {
    "test_homepage_loads": "Dashboard Homepage & Overview Initialization",
    "test_tabs_navigation": "Main Navigation & Component Routing",
    "test_athlete_dropdown_loads": "Athlete API Data Fetch & Dropdown Population",
    "test_upload_modal": "File Upload Modal & Drag-and-Drop Interface",
}

TEST_DETAILS = {
    "test_homepage_loads": "Simulates a user landing on the main dashboard URL. Verifies that the initial load completes successfully, no blank screens occur, and the default 'Overview' tab is automatically rendered with live data visualizations.",
    "test_tabs_navigation": "Sequentially clicks through every major tab (Overview, BIOPOD, Biodex, AI Forecast, Athlete, Compare, Upload PDF) to verify that internal JS routing properly switches components and removes hidden classes without throwing exceptions.",
    "test_athlete_dropdown_loads": "Navigates to the Athlete Profile tab and waits for the asynchronous API fetch to complete. Validates that the backend successfully returns athlete records and populates the dropdown select element.",
    "test_upload_modal": "Opens the Upload PDF tab and simulates a click on the manual entry trigger. Verifies that the modal component is properly displayed and not blocked by any CSS or JavaScript errors."
}

def generate_html(report_data):
    passed = report_data['summary'].get('passed', 0)
    failed = report_data['summary'].get('failed', 0)
    total = report_data['summary'].get('total', 0)
    
    date_str = datetime.now().strftime("%B %d, %Y - %I:%M %p")
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Deep Testing Audit Report</title>
        <style>
            body {{ font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 40px; }}
            .container {{ max-width: 900px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); border-top: 8px solid #2563eb; }}
            h1 {{ margin-top: 0; color: #0f172a; font-size: 28px; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; }}
            .meta {{ color: #64748b; font-size: 14px; margin-bottom: 30px; display: flex; justify-content: space-between; }}
            
            .summary-cards {{ display: flex; gap: 20px; margin-bottom: 40px; }}
            .card {{ flex: 1; padding: 20px; border-radius: 8px; text-align: center; }}
            .card-total {{ background-color: #f1f5f9; border: 1px solid #e2e8f0; }}
            .card-pass {{ background-color: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }}
            .card-fail {{ background-color: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }}
            .card .num {{ font-size: 32px; font-weight: bold; margin-bottom: 4px; }}
            .card .label {{ font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }}
            
            .test-list {{ list-style: none; padding: 0; margin: 0; }}
            .test-item {{ padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 16px; background: #fff; }}
            .test-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }}
            .test-title {{ font-size: 18px; font-weight: bold; color: #0f172a; margin: 0; }}
            .badge {{ padding: 6px 12px; border-radius: 9999px; font-size: 12px; font-weight: bold; text-transform: uppercase; }}
            .badge-pass {{ background: #dcfce7; color: #166534; }}
            .badge-fail {{ background: #fee2e2; color: #991b1b; }}
            
            .test-desc {{ color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 12px 0; }}
            .test-error {{ background: #1e293b; color: #f8fafc; padding: 16px; border-radius: 6px; font-family: monospace; font-size: 12px; overflow-x: auto; white-space: pre-wrap; }}
            
            .footer {{ margin-top: 40px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>CHPH Analytics Dashboard - E2E Testing Audit</h1>
            <div class="meta">
                <span><strong>Target Environment:</strong> Chrome (Headless) / Node.js Backend</span>
                <span><strong>Report Generated:</strong> {date_str}</span>
            </div>
            
            <div class="summary-cards">
                <div class="card card-total">
                    <div class="num">{total}</div>
                    <div class="label">Total Scenarios</div>
                </div>
                <div class="card card-pass">
                    <div class="num">{passed}</div>
                    <div class="label">Passed</div>
                </div>
                <div class="card card-fail">
                    <div class="num">{failed}</div>
                    <div class="label">Failed</div>
                </div>
            </div>
            
            <h2 style="font-size: 20px; color: #334155; margin-bottom: 20px;">Detailed Execution Log</h2>
            <ul class="test-list">
    """
    
    for test in report_data.get('tests', []):
        name = test['nodeid'].split('::')[-1]
        outcome = test['outcome']
        
        title = TEST_DESCRIPTIONS.get(name, name)
        desc = TEST_DETAILS.get(name, "Automated Selenium UI Test.")
        
        badge_class = "badge-pass" if outcome == "passed" else "badge-fail"
        
        html += f"""
                <li class="test-item">
                    <div class="test-header">
                        <h3 class="test-title">{title}</h3>
                        <span class="badge {badge_class}">{outcome.upper()}</span>
                    </div>
                    <p class="test-desc">{desc}</p>
        """
        
        if outcome == "failed":
            error_msg = ""
            if 'call' in test and 'crash' in test['call']:
                error_msg = test['call']['crash']['message']
            html += f'<div class="test-error"><strong>Assertion / Exception:</strong><br>{error_msg}</div>'
            
        html += "</li>"
        
    html += """
            </ul>
            
            <div class="footer">
                Automated UI Testing Pipeline &bull; Powered by Selenium & Pytest
            </div>
        </div>
    </body>
    </html>
    """
    
    with open("deep_report.html", "w") as f:
        f.write(html)


def generate_pdf_from_html(html_file, pdf_file):
    print(f"Opening HTML report {html_file} in headless Chrome...")
    options = webdriver.ChromeOptions()
    options.add_argument('--headless')
    options.add_argument('--disable-gpu')
    options.add_argument('--no-sandbox')
    
    driver = webdriver.Chrome(options=options)
    
    abs_path = os.path.abspath(html_file)
    driver.get(f'file://{abs_path}')
    time.sleep(2)
    
    print("Generating PDF...")
    print_options = {
        'landscape': False,
        'displayHeaderFooter': False,
        'printBackground': True,
        'preferCSSPageSize': True,
    }
    
    result = driver.execute_cdp_cmd("Page.printToPDF", print_options)
    
    with open(pdf_file, 'wb') as file:
        file.write(base64.b64decode(result['data']))
    
    driver.quit()

if __name__ == "__main__":
    print("Running deep testing suite...")
    
    # Run pytest and generate JSON report
    subprocess.run([
        "venv/bin/pytest", 
        "tests/", 
        "--json-report",
        "--json-report-file=report.json"
    ])
    
    print("Parsing JSON results...")
    with open("report.json", "r") as f:
        report_data = json.load(f)
        
    print("Generating Aesthetic HTML...")
    generate_html(report_data)
    
    print("Converting to PDF...")
    pdf_report_path = "In_Depth_Testing_Audit.pdf"
    generate_pdf_from_html("deep_report.html", pdf_report_path)
    
    print(f"SUCCESS! Deep Audit PDF created at: {pdf_report_path}")
