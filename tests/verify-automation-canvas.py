from playwright.sync_api import sync_playwright

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://127.0.0.1:3010/automations/new")
    page.wait_for_load_state("networkidle")
    print(f"url={page.url}")
    print(f"canvas={page.locator('.react-flow').count()}")
    print(f"title={page.title()}")
    browser.close()
