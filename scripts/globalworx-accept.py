"""
GlobalWorx Auto-Accept Script
Checks Gmail for unprocessed service alert emails, extracts the acceptance URL,
opens it in a browser, and clicks through to accept with 48-hour resolution.

Usage:
  pip install selenium google-auth google-auth-oauthlib google-api-python-client
  python globalworx-accept.py

Or run via: globalworx-accept.bat
"""

import os
import sys
import re
import time
import base64
import json
from pathlib import Path

# Google API
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Selenium
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

# ── Config ────────────────────────────────────────────────────────────────────
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']
ALERT_SENDER = 'MailAgent@synergies4u.com'
SCRIPT_DIR = Path(__file__).parent
TOKEN_FILE = SCRIPT_DIR / 'gw-token.json'
CREDS_FILE = SCRIPT_DIR / 'gw-credentials.json'

# Gmail labels
PROCESSED_LABEL = 'Processed'
LOGGED_LABEL = 'Map Tracker/Logged'

# GlobalWorx acceptance URL pattern
GW_URL_PATTERN = re.compile(
    r'https?://[^\s"\'<>]+go\.mbl\?[^\s"\'<>]+action=schedule\.RemoteAccept[^\s"\'<>]*',
    re.IGNORECASE
)
GW_FALLBACK_PATTERN = re.compile(
    r'https?://[^\s"\'<>]*adusa\.goglobalworx\.com[^\s"\'<>]*',
    re.IGNORECASE
)

# Resolution time
RESOLUTION_HOURS = '48'


def get_gmail_service():
    """Authenticate and return Gmail API service."""
    creds = None

    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print('Refreshing expired token...')
            creds.refresh(Request())
        else:
            if not CREDS_FILE.exists():
                print(f'ERROR: {CREDS_FILE} not found.')
                print('Download your OAuth credentials JSON from Google Cloud Console')
                print(f'and save it as: {CREDS_FILE}')
                sys.exit(1)
            print('Opening browser for Gmail authorization...')
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)

        # Save token for next run
        with open(TOKEN_FILE, 'w') as f:
            f.write(creds.to_json())
        print('Token saved.')

    return build('gmail', 'v1', credentials=creds)


def get_or_create_label(service, label_name):
    """Get Gmail label ID, creating it if needed."""
    results = service.users().labels().list(userId='me').execute()
    for label in results.get('labels', []):
        if label['name'] == label_name:
            return label['id']

    # Create it
    body = {'name': label_name, 'labelListVisibility': 'labelShow', 'messageListVisibility': 'show'}
    label = service.users().labels().create(userId='me', body=body).execute()
    print(f'Created label: {label_name}')
    return label['id']


def decode_body(payload):
    """Extract email body HTML from Gmail message payload."""
    if payload.get('body', {}).get('data'):
        return base64.urlsafe_b64decode(payload['body']['data']).decode('utf-8', errors='replace')

    for part in payload.get('parts', []):
        if part.get('mimeType') == 'text/html' and part.get('body', {}).get('data'):
            return base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='replace')
        if part.get('parts'):
            result = decode_body(part)
            if result:
                return result
    return ''


def extract_acceptance_url(html):
    """Extract GlobalWorx acceptance URL from email HTML."""
    if not html:
        return None
    cleaned = html.replace('&amp;', '&').replace('&#38;', '&')
    m = GW_URL_PATTERN.search(cleaned)
    if m:
        url = m.group(0).rstrip(')>]"\',.; ')
        return url
    fb = GW_FALLBACK_PATTERN.search(cleaned)
    if fb:
        return fb.group(0).rstrip(')>]"\',.; ')
    return None


def fetch_unprocessed_alerts(service, processed_label_id, max_results=20):
    """Fetch alert emails that haven't been processed yet."""
    query = f'from:{ALERT_SENDER} subject:"Service Alert created for" -label:{PROCESSED_LABEL}'
    print(f'Searching: {query}')

    results = service.users().messages().list(
        userId='me', q=query, maxResults=max_results
    ).execute()

    messages = results.get('messages', [])
    if not messages:
        print('No unprocessed alert emails found.')
        return []

    print(f'Found {len(messages)} unprocessed alert(s)')
    alerts = []

    for msg_meta in messages:
        msg = service.users().messages().get(
            userId='me', id=msg_meta['id'], format='full'
        ).execute()

        # Get subject
        subject = ''
        for header in msg.get('payload', {}).get('headers', []):
            if header['name'].lower() == 'subject':
                subject = header['value']
                break

        # Check if already has Processed label
        labels = msg.get('labelIds', [])
        if processed_label_id in labels:
            continue

        # Extract acceptance URL
        body_html = decode_body(msg.get('payload', {}))
        url = extract_acceptance_url(body_html)

        if url:
            alerts.append({
                'id': msg_meta['id'],
                'subject': subject,
                'url': url,
            })
            print(f'  [{len(alerts)}] {subject[:80]}')
        else:
            print(f'  [skip] No acceptance URL: {subject[:80]}')

    return alerts


def accept_alert_in_browser(driver, url, alert_num, total):
    """Navigate to GlobalWorx acceptance URL and click through the form."""
    print(f'\n  ({alert_num}/{total}) Opening: {url[:100]}...')

    try:
        driver.get(url)
        wait = WebDriverWait(driver, 15)

        # Wait for page to load
        time.sleep(3)

        # Strategy 1: Look for "Accept" button
        accept_clicked = False
        for selector in [
            (By.XPATH, "//button[contains(text(), 'Accept')]"),
            (By.XPATH, "//input[@value='Accept']"),
            (By.XPATH, "//a[contains(text(), 'Accept')]"),
            (By.XPATH, "//*[contains(@class, 'accept')]"),
            (By.XPATH, "//button[contains(text(), 'Accept Issue')]"),
            (By.XPATH, "//input[contains(@value, 'Accept')]"),
        ]:
            try:
                btn = driver.find_element(*selector)
                if btn.is_displayed():
                    print(f'    Found Accept button: {selector[1][:50]}')
                    btn.click()
                    accept_clicked = True
                    break
            except:
                continue

        if not accept_clicked:
            # Maybe the page already shows the form (URL pre-accepts)
            print('    No Accept button found, checking if form is already shown...')

        time.sleep(2)

        # Strategy 2: Set resolution time to 48 hours
        time_set = False
        # Try dropdown/select
        for selector in [
            (By.XPATH, "//select[contains(@name, 'hour') or contains(@name, 'time') or contains(@name, 'resolution')]"),
            (By.XPATH, "//select[contains(@id, 'hour') or contains(@id, 'time') or contains(@id, 'resolution')]"),
            (By.XPATH, "//select"),
        ]:
            try:
                selects = driver.find_elements(*selector)
                for sel_elem in selects:
                    if sel_elem.is_displayed():
                        select = Select(sel_elem)
                        # Try to find 48 hour option
                        for opt in select.options:
                            if '48' in opt.text:
                                select.select_by_visible_text(opt.text)
                                print(f'    Set resolution to: {opt.text}')
                                time_set = True
                                break
                        if time_set:
                            break
            except:
                continue

        if not time_set:
            # Try input field
            for selector in [
                (By.XPATH, "//input[contains(@name, 'hour') or contains(@name, 'time')]"),
                (By.XPATH, "//input[@type='number']"),
            ]:
                try:
                    inp = driver.find_element(*selector)
                    if inp.is_displayed():
                        inp.clear()
                        inp.send_keys(RESOLUTION_HOURS)
                        print(f'    Entered resolution: {RESOLUTION_HOURS} hours')
                        time_set = True
                        break
                except:
                    continue

        time.sleep(1)

        # Strategy 3: Submit / Confirm
        submitted = False
        for selector in [
            (By.XPATH, "//button[contains(text(), 'Submit')]"),
            (By.XPATH, "//button[contains(text(), 'Confirm')]"),
            (By.XPATH, "//button[contains(text(), 'Accept Issue')]"),
            (By.XPATH, "//input[@type='submit']"),
            (By.XPATH, "//input[contains(@value, 'Submit')]"),
            (By.XPATH, "//input[contains(@value, 'Confirm')]"),
            (By.XPATH, "//input[contains(@value, 'Accept')]"),
            (By.XPATH, "//button[contains(@class, 'submit')]"),
            (By.XPATH, "//a[contains(text(), 'Submit')]"),
        ]:
            try:
                btn = driver.find_element(*selector)
                if btn.is_displayed():
                    print(f'    Clicking submit: {selector[1][:50]}')
                    btn.click()
                    submitted = True
                    break
            except:
                continue

        time.sleep(2)

        if submitted:
            print(f'    ACCEPTED successfully')
        else:
            # Take screenshot for debugging
            ss_path = SCRIPT_DIR / f'gw-debug-{alert_num}.png'
            driver.save_screenshot(str(ss_path))
            print(f'    Could not find submit button. Screenshot saved: {ss_path}')

        return submitted

    except Exception as e:
        print(f'    ERROR: {e}')
        try:
            ss_path = SCRIPT_DIR / f'gw-error-{alert_num}.png'
            driver.save_screenshot(str(ss_path))
            print(f'    Error screenshot saved: {ss_path}')
        except:
            pass
        return False


def label_message(service, msg_id, label_id):
    """Add a label to a Gmail message."""
    service.users().messages().modify(
        userId='me', id=msg_id,
        body={'addLabelIds': [label_id]}
    ).execute()


def main():
    print('=' * 60)
    print('GlobalWorx Auto-Accept')
    print('=' * 60)
    print()

    # 1. Connect to Gmail
    print('Connecting to Gmail...')
    service = get_gmail_service()
    print('Connected.\n')

    # 2. Get/create labels
    processed_id = get_or_create_label(service, PROCESSED_LABEL)
    logged_id = get_or_create_label(service, LOGGED_LABEL)

    # 3. Fetch unprocessed alerts
    alerts = fetch_unprocessed_alerts(service, processed_id)
    if not alerts:
        print('\nAll caught up! No alerts to process.')
        return

    print(f'\n{len(alerts)} alert(s) to accept.\n')

    # 4. Launch browser
    print('Launching Chrome...')
    chrome_options = Options()
    # Run headless (no visible window) — remove this line to see the browser
    # chrome_options.add_argument('--headless=new')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--window-size=1280,900')

    driver = webdriver.Chrome(options=chrome_options)
    print('Chrome ready.\n')

    accepted = 0
    failed = 0

    try:
        for i, alert in enumerate(alerts, 1):
            print(f'--- Alert {i}/{len(alerts)} ---')
            print(f'  Subject: {alert["subject"][:100]}')

            success = accept_alert_in_browser(driver, alert['url'], i, len(alerts))

            if success:
                # Label as Processed in Gmail
                label_message(service, alert['id'], processed_id)
                label_message(service, alert['id'], logged_id)
                print(f'    Labeled as Processed in Gmail')
                accepted += 1
            else:
                failed += 1

            # Small delay between alerts
            if i < len(alerts):
                time.sleep(2)

    finally:
        driver.quit()
        print('\nBrowser closed.')

    # Summary
    print()
    print('=' * 60)
    print(f'DONE: {accepted} accepted, {failed} failed out of {len(alerts)} alerts')
    print('=' * 60)


if __name__ == '__main__':
    main()
