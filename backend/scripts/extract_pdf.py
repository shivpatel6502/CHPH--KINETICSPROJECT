#!/usr/bin/env python3
"""
PDF Data Extractor for CHPH Performance Analytics Dashboard
Supports: Biodex Comprehensive Reports + BOD POD body composition reports
Outputs: JSON to stdout, errors to stderr
Usage: python3 extract_pdf.py <path_to_pdf>
"""

import sys
import json
import re
import os
import pdfplumber
from datetime import datetime


# ── Utility helpers ────────────────────────────────────────────────────────────

def safe_float(val):
    """Convert string to float, return None on failure."""
    if val is None:
        return None
    try:
        cleaned = str(val).strip().replace('%', '').replace(',', '')
        return float(cleaned)
    except (ValueError, TypeError):
        return None


def safe_int(val):
    v = safe_float(val)
    return int(v) if v is not None else None


def normalize_date(raw):
    """Try multiple date formats; return ISO string or None."""
    if not raw:
        return None
    raw = raw.strip()
    for fmt in ('%m/%d/%Y', '%Y-%m-%d', '%d/%m/%Y', '%B %d, %Y'):
        try:
            return datetime.strptime(raw, fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    return None


def extract_text_full(pdf_path):
    """Return concatenated text from all pages."""
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text(x_tolerance=3, y_tolerance=3)
            if t:
                pages.append(t)
    return '\n'.join(pages)


# ── Biodex extractor ───────────────────────────────────────────────────────────

def detect_biodex(text):
    """Return True if this looks like a Biodex report."""
    indicators = ['Biodex', 'Peak Torque', 'AGON/ANTAG', 'EXT/FLEX', 'deg/s', 'Torque (N']
    hits = sum(1 for ind in indicators if ind.lower() in text.lower())
    return hits >= 3


def parse_biodex_header(text):
    """Extract patient/test metadata from Biodex report header."""
    info = {}

    # ── Patient name — try multiple patterns in priority order ──
    name = None

    # 1. Explicit "Patient Name:" label (most reliable)
    m = re.search(r'Patient Name[:\s]+([A-Za-z][A-Za-z\s,\.]{2,40}?)(?:\n|Patient ID|Age|Gender|Date|Joint|Weight)', text)
    if m:
        candidate = m.group(1).strip()
        # Reject if it looks like a column header or metric name
        bad_words = {'avg', 'peak', 'torque', 'work', 'power', 'ratio', 'ext', 'flex', 'left', 'right', 'set', 'rep'}
        if not any(w in candidate.lower() for w in bad_words):
            name = candidate

    # 2. "Name:" label (some Biodex versions)
    if not name:
        m = re.search(r'(?:^|\n)Name[:\s]+([A-Za-z][A-Za-z\s,\.]{2,40}?)(?:\n|ID|Age|Gender)', text)
        if m:
            candidate = m.group(1).strip()
            bad_words = {'avg', 'peak', 'torque', 'work', 'power', 'ratio', 'ext', 'flex'}
            if not any(w in candidate.lower() for w in bad_words):
                name = candidate

    # 3. "FirstName LastName" on its own line at the very top (first 400 chars)
    #    Must look like a real name: two capitalised words, no digits, not a known header word
    if not name:
        top = text[:400]
        for line in top.split('\n'):
            line = line.strip()
            # Two or more capitalised words, letters only (allow hyphens and apostrophes)
            if re.match(r"^[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3}$", line):
                bad_words = {'biodex', 'comprehensive', 'report', 'summary', 'evaluation',
                             'avg', 'peak', 'extension', 'flexion', 'knee', 'shoulder',
                             'left', 'right', 'set', 'speed', 'torque', 'pattern', 'joint',
                             'patient', 'date', 'gender', 'weight', 'height', 'age'}
                if not any(w in line.lower() for w in bad_words):
                    name = line
                    break

    if name:
        info['patient_name'] = name

    # Age
    m = re.search(r'Age[:\s]+(\d+)', text)
    if m:
        info['age'] = safe_int(m.group(1))

    # Gender
    m = re.search(r'Gender[:\s]+(Male|Female)', text, re.IGNORECASE)
    if m:
        info['gender'] = m.group(1).capitalize()

    # Weight kg
    m = re.search(r'Weight\s*\(kg\)[:\s]+([\d.]+)', text)
    if m:
        info['weight_kg'] = safe_float(m.group(1))

    # Height cm
    m = re.search(r'Height\s*\(cm\)[:\s]+([\d.]+)', text)
    if m:
        info['height_cm'] = safe_float(m.group(1))

    # Test date
    m = re.search(r'Date[:\s]+(\d{1,2}/\d{1,2}/\d{4})', text)
    if m:
        info['test_date'] = normalize_date(m.group(1))

    # Joint
    m = re.search(r'Joint[:\s]+(Knee|Shoulder|Hip|Ankle|Elbow|Wrist)', text, re.IGNORECASE)
    if m:
        info['joint'] = m.group(1).capitalize()

    # Pattern
    m = re.search(r'Pattern[:\s]+([A-Z/]+)', text)
    if m:
        info['pattern'] = m.group(1).strip()

    return info


def parse_biodex_set(text, set_num, speed):
    """
    Parse one set of Biodex data (Extension + Flexion at a given speed).
    Returns a dict with left/right values for key metrics.
    """
    data = {'set_num': set_num, 'speed_degs': speed}

    # Peak Torque row: "Peak Torque (N•m)  165.1 (Rep 1)  130.7 (Rep 1)  20.9  ..."
    pt_pattern = r'Peak Torque\s*\(N[•·]m\)\s+([\d.]+)\s*(?:\(Rep\s*\d+\))?\s+([\d.]+)\s*(?:\(Rep\s*\d+\))?\s+([\d.]+)'
    m = re.search(pt_pattern, text, re.IGNORECASE)
    if m:
        data['peak_torque_ext_left'] = safe_float(m.group(1))
        data['peak_torque_ext_right'] = safe_float(m.group(2))
        data['peak_torque_ext_deficit'] = safe_float(m.group(3))

    # Avg Peak Torque
    apt_pattern = r'Avg\.\s*Peak Torque\s*\(N[•·]m\)\s+([\d.]+)\s+([\d.]+)'
    m = re.search(apt_pattern, text, re.IGNORECASE)
    if m:
        data['avg_peak_torque_ext_left'] = safe_float(m.group(1))
        data['avg_peak_torque_ext_right'] = safe_float(m.group(2))

    # Peak Torque/BW (%)
    ptbw_pattern = r'Peak Torque/BW\s*\(%\)\s+([\d.]+)\s+([\d.]+)'
    m = re.search(ptbw_pattern, text, re.IGNORECASE)
    if m:
        data['peak_tq_bw_ext_left'] = safe_float(m.group(1))
        data['peak_tq_bw_ext_right'] = safe_float(m.group(2))

    # AGON/ANTAG Ratio — these are the H:Q ratios
    hq_pattern = r'AGON/ANTAG Ratio\s*\(%\)\s+([\d.]+)\s+([\d.]+)'
    m = re.search(hq_pattern, text, re.IGNORECASE)
    if m:
        # Stored as percentage; convert to decimal ratio
        left_pct = safe_float(m.group(1))
        right_pct = safe_float(m.group(2))
        data['hq_ratio_left'] = round(left_pct / 100, 4) if left_pct else None
        data['hq_ratio_right'] = round(right_pct / 100, 4) if right_pct else None

    # Flexion Peak Torque (4th and 5th number columns in Peak Torque row)
    # The Biodex report has: Extension Left | Extension Right | Deficit | Flexion Left | Flexion Right | Deficit
    pt_full = r'Peak Torque\s*\(N[•·]m\)\s+([\d.]+)\s*(?:\(Rep\s*\d+\))?\s+([\d.]+)\s*(?:\(Rep\s*\d+\))?\s+([\d.]+)\s+([\d.]+)\s*(?:\(Rep\s*\d+\))?\s+([\d.]+)\s*(?:\(Rep\s*\d+\))?\s+([\d.]+)'
    m = re.search(pt_full, text, re.IGNORECASE)
    if m:
        data['peak_torque_ext_left'] = safe_float(m.group(1))
        data['peak_torque_ext_right'] = safe_float(m.group(2))
        data['peak_torque_ext_deficit'] = safe_float(m.group(3))
        data['peak_torque_flex_left'] = safe_float(m.group(4))
        data['peak_torque_flex_right'] = safe_float(m.group(5))
        data['peak_torque_flex_deficit'] = safe_float(m.group(6))

    # Avg Peak Torque full row
    apt_full = r'Avg\.\s*Peak Torque\s*\(N[•·]m\)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)'
    m = re.search(apt_full, text, re.IGNORECASE)
    if m:
        data['avg_peak_torque_ext_left'] = safe_float(m.group(1))
        data['avg_peak_torque_ext_right'] = safe_float(m.group(2))
        data['avg_peak_torque_flex_left'] = safe_float(m.group(3))
        data['avg_peak_torque_flex_right'] = safe_float(m.group(4))

    # Total Work
    tw_full = r'Total Work\s*\(J\)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)'
    m = re.search(tw_full, text, re.IGNORECASE)
    if m:
        data['total_work_ext_left'] = safe_float(m.group(1))
        data['total_work_ext_right'] = safe_float(m.group(2))
        data['total_work_flex_left'] = safe_float(m.group(4))
        data['total_work_flex_right'] = safe_float(m.group(5))

    # Work Fatigue
    wf_full = r'Work Fatigue\s*\(%\)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)'
    m = re.search(wf_full, text, re.IGNORECASE)
    if m:
        data['work_fatigue_ext_left'] = safe_float(m.group(1))
        data['work_fatigue_ext_right'] = safe_float(m.group(2))
        data['work_fatigue_flex_left'] = safe_float(m.group(3))
        data['work_fatigue_flex_right'] = safe_float(m.group(4))

    # Peak Power
    pp_full = r'Peak Power\s*\(W\)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)'
    m = re.search(pp_full, text, re.IGNORECASE)
    if m:
        data['peak_power_ext_left'] = safe_float(m.group(1))
        data['peak_power_ext_right'] = safe_float(m.group(2))
        data['peak_power_flex_left'] = safe_float(m.group(4))
        data['peak_power_flex_right'] = safe_float(m.group(5))

    # Avg Power
    ap_full = r'Avg\.\s*Power\s*\(W\)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)'
    m = re.search(ap_full, text, re.IGNORECASE)
    if m:
        data['avg_power_ext_left'] = safe_float(m.group(1))
        data['avg_power_ext_right'] = safe_float(m.group(2))
        data['avg_power_flex_left'] = safe_float(m.group(4))
        data['avg_power_flex_right'] = safe_float(m.group(5))

    # ROM
    m = re.search(r'ROM\s*\(deg\)\s+([\d.]+)\s+([\d.]+)', text, re.IGNORECASE)
    if m:
        data['rom_ext'] = safe_float(m.group(1))
        data['rom_flex'] = safe_float(m.group(2))

    # Number of reps
    m = re.search(r'Number of Reps\s+(\d+)\s+(\d+)', text, re.IGNORECASE)
    if m:
        data['reps_ext'] = safe_int(m.group(1))
        data['reps_flex'] = safe_int(m.group(2))

    # Compute L:R ratios if we have both sides
    for side in [('ext', 'quad'), ('flex', 'ham')]:
        direction, muscle = side
        l_key = f'peak_torque_{direction}_left'
        r_key = f'peak_torque_{direction}_right'
        if data.get(l_key) and data.get(r_key) and data[r_key] > 0:
            lr = round(min(data[l_key], data[r_key]) / max(data[l_key], data[r_key]), 4)
            data[f'lr_ratio_{direction}'] = lr

    return data


def parse_biodex_pdf(pdf_path):
    """Full Biodex PDF parser — handles multi-set (60/120/180 deg/s) reports."""
    with pdfplumber.open(pdf_path) as pdf:
        pages_text = []
        for page in pdf.pages:
            t = page.extract_text(x_tolerance=3, y_tolerance=3)
            if t:
                pages_text.append(t)

    full_text = '\n'.join(pages_text)
    header = parse_biodex_header(full_text)

    sets = []
    # Each page is typically one set; detect speed from "Extension (XX deg/s)"
    speed_pattern = re.compile(r'Extension\s*\((\d+)\s*deg/s\)', re.IGNORECASE)
    set_pattern = re.compile(r'Set\s+(\d+)\s+of\s+\d+', re.IGNORECASE)

    for i, page_text in enumerate(pages_text):
        speed_m = speed_pattern.search(page_text)
        set_m = set_pattern.search(page_text)
        speed = safe_int(speed_m.group(1)) if speed_m else (60 * (i + 1))
        set_num = safe_int(set_m.group(1)) if set_m else (i + 1)

        set_data = parse_biodex_set(page_text, set_num, speed)
        sets.append(set_data)

    # Build consolidated record (peak torque at each speed)
    result = {
        'type': 'biodex',
        'header': header,
        'sets': sets,
    }

    # Flatten sets into standard fields (60/120/180 deg/s)
    for s in sets:
        spd = s.get('speed_degs', 0)
        if spd == 60:
            result['quad_l_60'] = s.get('peak_torque_ext_left')
            result['quad_r_60'] = s.get('peak_torque_ext_right')
            result['ham_l_60'] = s.get('peak_torque_flex_left')
            result['ham_r_60'] = s.get('peak_torque_flex_right')
            result['quad_lr_60'] = s.get('lr_ratio_ext')
            result['ham_lr_60'] = s.get('lr_ratio_flex')
            result['lhq_60'] = s.get('hq_ratio_left')
            result['rhq_60'] = s.get('hq_ratio_right')
        elif spd == 120:
            result['quad_l_120'] = s.get('peak_torque_ext_left')
            result['quad_r_120'] = s.get('peak_torque_ext_right')
            result['ham_l_120'] = s.get('peak_torque_flex_left')
            result['ham_r_120'] = s.get('peak_torque_flex_right')
            result['quad_lr_120'] = s.get('lr_ratio_ext')
            result['ham_lr_120'] = s.get('lr_ratio_flex')
            result['lhq_120'] = s.get('hq_ratio_left')
            result['rhq_120'] = s.get('hq_ratio_right')
        elif spd == 180:
            result['quad_l_180'] = s.get('peak_torque_ext_left')
            result['quad_r_180'] = s.get('peak_torque_ext_right')
            result['ham_l_180'] = s.get('peak_torque_flex_left')
            result['ham_r_180'] = s.get('peak_torque_flex_right')
            result['quad_lr_180'] = s.get('lr_ratio_ext')
            result['ham_lr_180'] = s.get('lr_ratio_flex')
            result['lhq_180'] = s.get('hq_ratio_left')
            result['rhq_180'] = s.get('hq_ratio_right')

    # Classify asymmetry
    lr_vals = [v for k, v in result.items() if k.startswith('quad_lr_') and v is not None]
    if lr_vals:
        min_lr = min(lr_vals)
        if min_lr < 0.80:
            result['lr_class'] = 'Moderate Imbalance'
        elif min_lr < 0.90:
            result['lr_class'] = 'Monitoring'
        else:
            result['lr_class'] = 'No Imbalance'

    # Classify H:Q
    hq_vals = [v for k, v in result.items() if k.startswith('lhq_') or k.startswith('rhq_')]
    hq_vals = [v for v in hq_vals if v is not None]
    if hq_vals:
        min_hq = min(hq_vals)
        if min_hq < 0.40:
            result['hq_class'] = 'Moderate Imbalance'
        elif min_hq < 0.50:
            result['hq_class'] = 'Monitoring'
        else:
            result['hq_class'] = 'No Imbalance'

    return result


# ── BOD POD extractor ──────────────────────────────────────────────────────────

def detect_bodpod(text):
    """Return True if this looks like a BOD POD report."""
    indicators = ['BOD POD', 'BODPOD', 'BIOPOD', 'BIO POD', 'Body Composition', '% Fat', 'FFM', 'Fat Free Mass',
                  'Body Density', 'TGV', 'REE']
    hits = sum(1 for ind in indicators if ind.lower() in text.lower())
    return hits >= 3


def parse_bodpod_pdf(pdf_path):
    """Parse a BOD POD body composition report."""
    with pdfplumber.open(pdf_path) as pdf:
        full_text = '\n'.join(
            page.extract_text(x_tolerance=3, y_tolerance=3) or ''
            for page in pdf.pages
        )

    result = {'type': 'bodpod'}
    header = {}

    # Name
    m = re.search(r'Name\s+([A-Za-z][A-Za-z\s]+?)(?:\n|ID1|Gender)', full_text)
    if m:
        header['patient_name'] = m.group(1).strip()

    # Visit date
    m = re.search(r'Visit Date\s+(\d{1,2}/\d{1,2}/\d{4})', full_text)
    if m:
        header['test_date'] = normalize_date(m.group(1))
    else:
        m = re.search(r'(\d{1,2}/\d{1,2}/\d{4})', full_text)
        if m:
            header['test_date'] = normalize_date(m.group(1))

    # Gender
    m = re.search(r'Gender\s+(Male|Female)', full_text, re.IGNORECASE)
    if m:
        header['gender'] = m.group(1).capitalize()

    # Age
    m = re.search(r'Age\s+([\d.]+)', full_text)
    if m:
        header['age'] = safe_float(m.group(1))

    # Weight kg
    m = re.search(r'Weight\s*\(kg\)\s+([\d.]+)', full_text)
    if m:
        header['weight_kg'] = safe_float(m.group(1))
    # Weight lbs
    m = re.search(r'([\d.]+)\s+lbs?\s+Body Mass', full_text)
    if m:
        header['weight_lbs'] = safe_float(m.group(1))

    # Height cm
    m = re.search(r'Height\s*\(cm\)\s+([\d.]+)', full_text)
    if m:
        header['height_cm'] = safe_float(m.group(1))

    # BMI
    m = re.search(r'BMI\s*\(kg/m2?\)\s+([\d.]+)', full_text)
    if m:
        header['bmi'] = safe_float(m.group(1))

    result['header'] = header

    # Core body composition values
    # % Fat — look for bold/prominent value
    m = re.search(r'%\s*Fat\s+([\d.]+)\s*%', full_text)
    if not m:
        m = re.search(r'([\d.]+)\s*%\s*\n?%\s*Fat', full_text)
    
    # 2026 Tabular block fallback
    if not m:
        tab = re.search(r'([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\n\s*%\s*kg\s*kg\s*%\s*\n\s*%\s*Fat\s*FM\s*FFM\s*%\s*FFM', full_text)
        if tab:
            result['body_fat_pct'] = safe_float(tab.group(1)) / 100
            result['fat_mass_kg'] = safe_float(tab.group(2))
            result['fat_free_mass_kg'] = safe_float(tab.group(3))
            result['fat_free_mass_pct'] = safe_float(tab.group(4)) / 100
            m = tab
    if not m:
        m = re.search(r'[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+([\d.]+)\s*\n.*?%\s*Fat', full_text, re.DOTALL)
    if m:
        result['body_fat_pct'] = safe_float(m.group(1)) / 100  # store as decimal

    # Try direct pattern "20.1 %" or "20.1\n% Fat"
    if 'body_fat_pct' not in result:
        m = re.search(r'([\d.]+)\s*\n\s*%\s*Fat', full_text)
        if m:
            result['body_fat_pct'] = safe_float(m.group(1)) / 100

    # More aggressive fallbacks for % Fat
    if 'body_fat_pct' not in result:
        m = re.search(r'(?:%|Percent)\s*Fat\D*?([\d.]+)\s*%', full_text, re.IGNORECASE)
        if m: result['body_fat_pct'] = safe_float(m.group(1)) / 100
    if 'body_fat_pct' not in result:
        m = re.search(r'([\d.]+)\s*(?:%|Percent)\s*Fat', full_text, re.IGNORECASE)
        if m: result['body_fat_pct'] = safe_float(m.group(1)) / 100

    # FM (fat mass kg)
    m = re.search(r'([\d.]+)\s+kg\s+FM', full_text)
    if not m:
        m = re.search(r'FM\s+([\d.]+)\s+kg', full_text)
    if m:
        result['fat_mass_kg'] = safe_float(m.group(1))

    # FFM (fat free mass kg)
    m = re.search(r'([\d.]+)\s+kg\s+FFM', full_text)
    if not m:
        m = re.search(r'FFM\s+([\d.]+)\s+kg', full_text)
    if m:
        result['fat_free_mass_kg'] = safe_float(m.group(1))

    # % FFM
    m = re.search(r'([\d.]+)\s*%\s*\n?%\s*FFM', full_text)
    if not m:
        m = re.search(r'%\s*FFM\s+([\d.]+)', full_text)
    if m:
        result['fat_free_mass_pct'] = safe_float(m.group(1)) / 100

    # Body Mass lbs
    m = re.search(r'([\d.]+)\s+lbs\s*\n?\s*Body Mass', full_text)
    if not m:
        tab2 = re.search(r'([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\n\s*lbs\s*L\s*kg/L\s*L\s*\n\s*Body\s*Mass\s*Body\s*Volume', full_text)
        if tab2:
            result['weight_lbs'] = safe_float(tab2.group(1))
            m = tab2
    if not m:
        m = re.search(r'Body Mass\D*?([\d.]+)\s+lbs', full_text, re.IGNORECASE)
    if not m:
        m = re.search(r'Weight\D*?([\d.]+)\s*lbs', full_text, re.IGNORECASE)
    if m:
        result['weight_lbs'] = safe_float(m.group(1))
    elif header.get('weight_kg'):
        result['weight_lbs'] = round(header['weight_kg'] * 2.20462, 2)

    # Fat Free Mass lbs (derived)
    if result.get('fat_free_mass_kg'):
        result['fat_free_mass_lbs'] = round(result['fat_free_mass_kg'] * 2.20462, 2)

    # Body Density
    m = re.search(r'([\d.]+)\s+kg/L\s*\n?\s*Body Density', full_text)
    if m:
        result['body_density'] = safe_float(m.group(1))

    # TGV
    m = re.search(r'([\d.]+)\s+L\s*\n?\s*TGV', full_text)
    if m:
        result['tgv'] = safe_float(m.group(1))

    # REE
    m = re.search(r'([\d,]+)\s+kcal/day\s*\n?\s*REE', full_text)
    if m:
        result['ree_kcal'] = safe_int(m.group(1).replace(',', ''))

    # TEE
    m = re.search(r'([\d,]+)\s+kcal/day\s*\n?\s*TEE', full_text)
    if m:
        result['tee_kcal'] = safe_int(m.group(1).replace(',', ''))

    # Activity Level
    m = re.search(r'(Very Active|Active|Moderately Active|Lightly Active|Sedentary)\s*\n?\s*Activity Level', full_text, re.IGNORECASE)
    if m:
        result['activity_level'] = m.group(1)

    return result


def extract_name_from_filename(pdf_path):
    """
    Try to extract an athlete name from the filename.
    Handles patterns like:
      Comp_LTate_20260706.pdf       → "L Tate"
      Comp_LeahTate_2026.pdf        → "Leah Tate"
      MAYSA_A_BODPOD.pdf            → "Maysa A"
      Abby_Cullion_biodex.pdf       → "Abby Cullion"
      AbbyC_2026.pdf                → "Abby C"
    """
    base = os.path.splitext(os.path.basename(pdf_path))[0]
    # Remove common prefixes
    base = re.sub(r'^(Comp_|comp_|COMP_|Biodex_|biodex_|BOD_|bodpod_|BODPOD_)', '', base)
    # Remove trailing date/number suffixes (e.g. _20260706100205)
    base = re.sub(r'[_\-]\d{6,}.*$', '', base)
    base = re.sub(r'[_\-](20\d\d).*$', '', base)
    # Split on underscores/hyphens/spaces
    parts = re.split(r'[_\-\s]+', base)

    name_parts = []
    for part in parts:
        if not part:
            continue
        # Skip pure numbers or very short non-initial tokens
        if re.match(r'^\d+$', part):
            continue
        # Skip known non-name tokens
        if part.lower() in {'biodex', 'bodpod', 'comp', 'report', 'pdf', 'test', 'data', 'new', 'old'}:
            continue
        # Split CamelCase: "LTate" → ["L", "Tate"], "LeahTate" → ["Leah", "Tate"]
        camel_parts = re.findall(r'[A-Z][a-z]*|[A-Z]+(?=[A-Z])', part)
        if camel_parts:
            name_parts.extend(camel_parts)
        elif part[0].isupper() or len(part) <= 2:
            name_parts.append(part.capitalize())

    if len(name_parts) >= 1:
        return ' '.join(name_parts[:3])  # at most first+middle+last
    return None


# ── Main dispatcher ────────────────────────────────────────────────────────────

def extract_pdf(pdf_path):
    """Auto-detect PDF type and extract data."""
    if not os.path.exists(pdf_path):
        return {'error': f'File not found: {pdf_path}', 'type': 'error'}

    try:
        full_text = extract_text_full(pdf_path)
    except Exception as e:
        return {'error': f'Failed to read PDF: {str(e)}', 'type': 'error'}

    if not full_text.strip():
        return {'error': 'PDF contains no extractable text (may be scanned image)', 'type': 'error'}

    is_biodex = detect_biodex(full_text)
    is_bodpod = detect_bodpod(full_text)

    if is_biodex and not is_bodpod:
        try:
            result = parse_biodex_pdf(pdf_path)
        except Exception as e:
            return {'error': f'Biodex parsing failed: {str(e)}', 'type': 'error', 'raw_text': full_text[:500]}
    elif is_bodpod and not is_biodex:
        try:
            result = parse_bodpod_pdf(pdf_path)
        except Exception as e:
            return {'error': f'BOD POD parsing failed: {str(e)}', 'type': 'error', 'raw_text': full_text[:500]}
    else:
        biodex_score = sum(1 for w in ['Biodex', 'Peak Torque', 'AGON/ANTAG', 'deg/s'] if w in full_text)
        bodpod_score = sum(1 for w in ['BOD POD', 'Body Density', 'TGV', 'REE', 'Fat Free Mass'] if w in full_text)
        if biodex_score >= bodpod_score:
            try:
                result = parse_biodex_pdf(pdf_path)
            except Exception as e:
                return {'error': f'Parsing failed: {str(e)}', 'type': 'error'}
        else:
            try:
                result = parse_bodpod_pdf(pdf_path)
            except Exception as e:
                return {'error': f'Parsing failed: {str(e)}', 'type': 'error'}

    # ── Fallback: if no patient_name extracted from PDF, try the filename ──
    header = result.get('header', {})
    if not header.get('patient_name'):
        name_from_file = extract_name_from_filename(pdf_path)
        if name_from_file:
            header['patient_name'] = name_from_file
            header['name_source'] = 'filename'
            result['header'] = header

    return result


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: python3 extract_pdf.py <pdf_path>'}))
        sys.exit(1)

    result = extract_pdf(sys.argv[1])
    print(json.dumps(result, indent=2, default=str))
