# Service Data Upload — Jim WFM

Jim WFM now has **Service Excel Upload** in the left navigation.

## Supported Excel reports
- Buwelo Service.xlsx
- Concentrix Service.xlsx
- WNS Service.xlsx
- Telus Utilization.xlsx
- TUS Service Agents.xlsx

Use the original `.xlsx` files (not legacy `.xls`).
The center for utilization reports is determined by the filename. TELUS agent activity is recognized from the `Day of Created-At` / `Answered Calls` header.

## Updating data
1. Open **Service Excel Upload**.
2. Select one or all five workbooks, then click **Import selected files**.
3. Check the **30-day** cards, center comparison, and daily history.
4. Import fresh reports at any time; for each date and reporting center, the newest import **replaces** the earlier daily aggregate rather than adding to it.
5. Use **Export private JSON backup** to retain the information for another browser or computer. That JSON can be imported using the same file input.

## Measurements
- Original utilization workbooks report total **minutes** in statuses **Available**, **On Call**, **Break**, and (when present) **Offline**. The dashboard displays their totals as hours.
- **On-call share** = On Call minutes / (On Call + Available minutes). This is a measured status-time ratio, not proof of actual employee productivity or a real-time occupancy feed.
- TELUS call activity uses the `Service` and `Outbound Calls` sections, summing **Answered Calls** separately. All other centers' call volumes are unreported in these uploads.
- The data window is the most recent 30 calendar dates, including the browser's current date. Missing dates are **not filled as zero**.
- Counts of IDs represent distinct **per-day** contributors to available source rows, never live staffing counts.

## Privacy and limitations
- The importer runs entirely in your **browser** using built-in Excel ZIP/XML handling. No CDN, paid API, Ollama, or backend is required.
- Raw workbooks do not get uploaded. The importer discards employee names and IDs after computing **daily aggregate** measures, and it saves only those aggregates under `jimwfm-service-history-v1` in the browser's localStorage.
- This is **browser-local**, with **no login or cross-computer sync**. Only use a trusted, approved browser, especially on a shared work computer; anyone with that browser profile may access the imported aggregates.
- The repository is public, so **do not commit original workbooks, customer records, or private JSON backups to GitHub**.
- The existing "Live Agent Status" demo continues to show **synthetic** records; the new Service Excel Upload page is explicitly **historical**. It does not change agent records, payroll, scripts, password vaults, or the local AI gateway.
- Clearing browser data removes local history unless backed up first.

## Compatibility
- Current Chrome/Firefox with `DecompressionStream('deflate-raw')` support.
- Maximum of 12 files per batch, 25 MB per Excel file.
- If a report has a new layout or renamed columns, the importer rejects it rather than silently guessing.
