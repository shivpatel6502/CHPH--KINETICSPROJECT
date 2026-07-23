import pytest
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
import time

BASE_URL = "http://localhost:3001"

@pytest.fixture(scope="module")
def driver():
    options = webdriver.ChromeOptions()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
    
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    yield driver
    driver.quit()

def test_homepage_loads(driver):
    """Test that the homepage loads successfully and displays the Overview tab."""
    driver.get(BASE_URL)
    # Wait for the Overview tab to be visible
    overview_tab = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.XPATH, "//button[contains(text(), 'Overview')]"))
    )
    assert overview_tab.is_displayed()

def test_tabs_navigation(driver):
    """Test that clicking each tab changes the visible page section."""
    driver.get(BASE_URL)
    tabs = {
        "Overview": "page-overview",
        "BIOPOD": "page-biopod",
        "Biodex": "page-biodex",
        "Forecast": "page-forecast",
        "Athlete": "page-athlete",
        "Compare": "page-compare",
        "Upload PDF": "page-upload"
    }
    
    for tab_name, page_id in tabs.items():
        # Find the tab button and click it
        tab_button = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.XPATH, f"//button[contains(text(), '{tab_name}')]"))
        )
        # Using javascript click to avoid interception
        driver.execute_script("arguments[0].click();", tab_button)
        time.sleep(1)
        
        # Verify the corresponding page section is visible (not hidden)
        page_element = driver.find_element(By.ID, page_id)
        class_str = page_element.get_attribute("class")
        if "hidden" in class_str:
            logs = driver.get_log("browser")
            print(f"Browser logs for {tab_name}: {logs}")
        assert "hidden" not in class_str, f"Tab {tab_name} failed. Class: {class_str}"

def test_athlete_dropdown_loads(driver):
    """Test that the athlete dropdown populates with data from the backend."""
    driver.get(BASE_URL)
    # Go to Athlete tab
    athlete_tab = WebDriverWait(driver, 10).until(
        EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Athlete')]"))
    )
    driver.execute_script("arguments[0].click();", athlete_tab)
    
    # Wait for dropdown to populate (API fetch)
    dropdown = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.ID, "athleteSelect"))
    )
    # Wait a bit for the fetch to populate the options
    time.sleep(2)
    options = dropdown.find_elements(By.TAG_NAME, "option")
    
    # Verify that at least one athlete is loaded (excluding the default 'Select Athlete')
    assert len(options) > 1, "Dropdown should have multiple athletes loaded"


