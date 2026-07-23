import os
import subprocess
from selenium import webdriver
import base64
import time

def generate_pdf_from_html(html_file, pdf_file):
    print(f"Opening HTML report {html_file} in headless Chrome...")
    options = webdriver.ChromeOptions()
    options.add_argument('--headless')
    options.add_argument('--disable-gpu')
    options.add_argument('--no-sandbox')
    
    driver = webdriver.Chrome(options=options)
    
    # Get absolute path for file:// url
    abs_path = os.path.abspath(html_file)
    driver.get(f'file://{abs_path}')
    
    # Wait for the report to fully render
    time.sleep(2)
    
    print("Generating PDF...")
    # Print to PDF using Chrome DevTools Protocol
    print_options = {
        'landscape': False,
        'displayHeaderFooter': False,
        'printBackground': True,
        'preferCSSPageSize': True,
    }
    
    # execute_cdp_cmd returns base64 encoded PDF
    result = driver.execute_cdp_cmd("Page.printToPDF", print_options)
    
    with open(pdf_file, 'wb') as file:
        file.write(base64.b64decode(result['data']))
    
    driver.quit()

if __name__ == "__main__":
    print("Running Selenium Test Suite...")
    
    # Ensure tests directory exists
    if not os.path.exists("tests"):
        print("Error: 'tests' directory not found.")
        exit(1)
        
    html_report_path = "test_report.html"
    pdf_report_path = "Dashboard_Test_Report.pdf"
    
    # Execute pytest and generate the HTML report using pytest-html
    print("Executing tests and generating HTML report...")
    result = subprocess.run([
        "venv/bin/pytest", 
        "tests/", 
        f"--html={html_report_path}", 
        "--self-contained-html",
        "-v"
    ])
    
    print(f"Generated HTML report at {html_report_path}")
    
    # Convert the HTML report to a PDF
    try:
        generate_pdf_from_html(html_report_path, pdf_report_path)
        print(f"SUCCESS: PDF report generated successfully at {pdf_report_path}")
    except Exception as e:
        print(f"Error generating PDF: {e}")
        
    if result.returncode != 0:
        print("\nNote: Some tests failed. Check the PDF report for details.")
    else:
        print("\nAll tests passed successfully!")
