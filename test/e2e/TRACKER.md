# Compliance MCP Test Sequence — final tracker

Source: `mcp-test-prompt-sequence.html` · Harness: `test/e2e/` · Raw: `results.json` ·
Scope and caveats: `PLAN.md` · Remediation backlog: `FIXES.md`

**Run complete: all 7 phases, P00-P31, 48 checks.**
Dimension B only (do the tools work). Dimension A (does an assistant pick the right tool from
business language) needs a connector session and is marked `N/A-A`.

| Phase | Pass | Fail | Partial | N/A-A |
|---|---|---|---|---|
| 0 Entry | 2 | 0 | 0 | 0 |
| 1 Read-back | 2 | 0 | 0 | 1 |
| 2 Views | 2 | 2 | 0 | 0 |
| 3 Fields/calc | 9 | 1 | 2 | 0 |
| 4 AI agents | 5 | 1 | 1 | 1 |
| 5 Widgets | 4 | 3 | 1 | 0 |
| 6 Extended | 8 | 0 | 1 | 2 |
| **Total** | **32** | **7** | **5** | **4** |

## Everything not a clean pass

| ID | Status | What |
|---|---|---|
| P05 | FAIL | create_view/update_view expose no parameter for calendarFieldsWindow.fields, so the date binding cannot be set at all. UI-built calendars store calend |
| P06 | FAIL | groupBy wrote severity into groupbyWindow, but a kanban stacks on stackByWindow.columnFieldSlug, which stayed null — the board has no columns. Initial |
| P07b | PARTIAL | accepted a one-hop rollup for a two-hop question — no error surfaced |
| P08b | FAIL | API valid=true, lint caught reversed order=false |
| P09 | PARTIAL | both scales validate (0.9: true, 90: true) — the API cannot tell them apart, and neither is flagged. A formula reads a percent as a FRACTION, so 90 is |
| P14c | FAIL | model=undefined — real AI fields carry a "cred:<uuid>" reference |
| P15 | PARTIAL | enable_internet_search defaults to FALSE and the aiPrompt path never sets it, so a "find it online with a source link" prompt produces an agent that c |
| P18 | FAIL | 1/2 widgets added; 0 overlapping pair(s) among 1 on the tab |
| P18-countdown-widget | FAIL | SmartSuite API error 400: {"target_time":["Datetime has wrong format. Use one of these formats instead: YYYY-MM-DDThh:mm |
| P20 | FAIL | SmartSuite API error 400: {"values":["Field required"],"group_by":["Field required"],"totals":["Field required"],"benchmarks":["Fi |
| P23 | PARTIAL | heading-widget: FAIL SmartSuite API error 400: {"content":["Expected a dictionary | text-block-widget: FAIL SmartSuite API error 400: {"content":["Exp |
| P27 | PARTIAL | My trigger shape was wrong, not a tool defect — the description documents "an object with trigger_reference.trigger_id and inputs" and the 400 named t |

## Backlog

F1 calendar date binding · F2 kanban stack-by · F3 DATEDIFF lint too narrow ·
F4 percent-scale comparisons · F5 meaningless rollup accepted · F6 AI field has no model credential ·
F7 ai_agent settings undiscoverable · F8 widget params replaced wholesale ·
F9 widget types with undocumented required params · F10 automation trigger shapes undiscoverable

## Harness defects found and corrected during the run

Eight, all mine, every one initially indistinguishable from a server bug:
missing `allowedSolutions` in the test config; a substring assertion that passed a broken kanban;
wrong param names on `set_field_help_text` and `set_display_logic`; `create_dashboard` and
`describe_dashboard` both needing `applicationId`; `widgetsByTab` being an array of
`{tabId, widgets[]}` rather than a map; widget geometry being nested `position`/`size` rather than
flat; and a wrong automation trigger shape. Recorded because a suite that manufactures phantom
failures is worse than no suite — and because a surface this easy to mis-shape from the outside is
one an assistant will mis-shape too.
