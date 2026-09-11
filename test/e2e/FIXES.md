# Remediation backlog

**Cycle complete: 9 of 10 fixed and verified live; F6 needs an AI credential to settle.**

---

Collected during the run; worked through as one cycle after testing completes.
Each entry: what breaks, the evidence, and the shape of the fix.

---

## F1 — Calendar views cannot bind a date field (P05)

> **FIXED 1.0.3 — dateField param; verified live: calendarFieldsWindow.fields = [{slug: sf50c3f38d, ...}]**

**Severity: high.** Every calendar view created through the MCP opens blank, and the tool
reports success.

`create_view` / `update_view` accept only `visibleFields`, `filters`, `filterOperator`, `sort`,
`groupBy`. A calendar's date binding lives at `state.calendarFieldsWindow.fields[].slug` —
confirmed against three UI-built calendars, e.g.
`{"viewType":"dayGridMonth","fields":[{"slug":"due_date","color":{...}}]}`.

**Fix:** add a `dateField` parameter that writes `calendarFieldsWindow.fields`, and refuse to
create a calendar without one (or warn loudly), the same way a linked-record field without a
target is now refused.

## F2 — Kanban views cannot set their stack-by field (P06)

> **FIXED 1.0.3 — stackBy param; verified live: stackByWindow.columnFieldSlug = severity slug**

**Severity: high.** A kanban created through the MCP has no columns.

`groupBy` writes to `groupbyWindow`, but a kanban stacks on
`state.stackByWindow.columnFieldSlug`, which stays `null`. Measured on a board where severity
was passed as `groupBy`: `stackByWindow.columnFieldSlug: null`,
`groupbyWindow.group: [{field: "sf6e518c81"}]` — the value written, in the wrong place.

**Fix:** add a `stackBy` parameter mapping to `stackByWindow.columnFieldSlug` (plus
`swimlaneFieldSlug` for the second axis), and validate that a kanban has one.

---

## Cross-cutting note

F1 and F2 are the same shape: `create_view`/`update_view` model a view as filters + sort +
columns, but several view modes need a **field binding** that lives in its own `*Window` object.
Timeline, gantt and map (`locationByWindow`, `timelineFieldsWindow`, `ganttFieldsWindow`) are
almost certainly affected the same way and should be checked as part of the fix rather than
found one at a time.

## F3 — The reversed-DATEDIFF lint rule is too narrow to catch the common case (P08)

> **FIXED 1.0.3 — widened; verified live: DATEDIFF(NOW(),[due]) now lints datediff-order**

**Severity: medium.** The rule added in 1.0.1 only fires when argument 1 is `NOW()`/`TODAY()`
or a `lastupdatedfield` **and** argument 2 is a `firstcreatedfield`. The everyday mistake —
comparing against an ordinary date field — slips through:

```
DATEDIFF(NOW(), [due_date], "days")   ->  API valid=true, lint caught it: NO
```

Every finding then shows a negative "days overdue", which is exactly P08's stated trap.

**Fix:** widen the heuristic — flag `DATEDIFF` whenever argument 1 is `NOW()`/`TODAY()` or a
modified-timestamp field and argument 2 is *any* date-typed field (or vice versa). Ordering
between two arbitrary date fields is genuinely ambiguous and should stay unflagged, but a
`NOW()`-first comparison is almost never intended.

## F4 — Percent-scale mistakes in formulas are invisible (P09)

> **FIXED 1.0.3 — new percent-threshold rule; verified live: ">= 90" hints "Write >= 0.9 for 90%"**

**Severity: medium.** A percent field stores `67.0` but a **formula reads `0.67`**. Both
threshold styles validate clean and neither is flagged:

```
IF([coverage] >= 0.9,  ...)   valid  (correct)
IF([coverage] >= 90,   ...)   valid  (every record falls into the same band)
```

The existing `percent-arithmetic` lint rule only catches division by 100; it says nothing about
a comparison.

**Fix:** extend the rule — when a `percentfield` slug is compared with a numeric literal `> 1`,
warn that formulas see the fraction and the threshold is likely 100x too large. This is the
same finding that makes the source document's P09 "Watch for" backwards (see PLAN.md).

## F5 — A rollup that cannot answer the question is accepted silently (P07b)

> **FIXED 1.0.3 — rollup over title refused; verified live**

**Severity: low.** "Controls behind each regulation" is two hops (Regulations -> Requirements
-> Controls). A one-hop `sum` rollup over the requirement titles was accepted without
complaint, producing a field that computes nothing useful.

**Fix:** low priority, but `sum`/`min`/`max`/`average`/`range` over a non-numeric
`field_selection` is never meaningful — warn at create time, the way an unknown rollup function
is now rejected.

## F6 — AI fields are created without a model credential (P14c)

> **OPEN — needs a solution with an AI credential to determine whether model is required at run time**

**Severity: medium, needs one more check.** All 22 AI fields found in production carry
`ai_agent.model: "cred:<uuid>"`. A field created through `aiPrompt` has `model: undefined`:

```
MCP-created:  { enabled, instructions, enable_internet_search, run_automatically }   <- no model
UI-created:   { enabled, instructions, enable_internet_search, run_automatically, model: "cred:..." }
```

**Unverified:** whether SmartSuite falls back to a workspace default model at run time, or whether
the agent simply never fires. That distinction decides the severity, and I could not settle it —
`list_automation_credentials` returned **0** credentials for the test solution, so there was no
credential to attach and nothing to observe. Check against a solution that has an AI credential
before fixing.

**Fix (pending that check):** if a model is required, resolve and attach the workspace's default AI
credential when `aiPrompt` is used, or refuse with a message naming the credential to pass —
rather than creating an agent that looks configured and never runs.

## F7 — The ai_agent settings that matter are undiscoverable (P15)

> **FIXED 1.0.3 — keys and defaults named in the description**

**Severity: medium.** `enable_internet_search` defaults to **false**, so "summarise the latest
guidance, found online, with a link to the source" yields an agent that cannot search and can only
fabricate the link. The setting works perfectly when passed (P15b confirms), but `create_field`'s
description only says *"put the AI model/credential and other ai_agent settings in params.ai_agent
if needed"* — it never names `enable_internet_search` or `run_automatically`, and never says search
is off by default.

Same shape as the `countfield` gap fixed in 1.0.2: the capability exists, nothing points at it, so
callers produce a broken result and are told it succeeded.

**Fix:** name the keys and their defaults in the description —
`ai_agent: { enable_internet_search (default false), run_automatically (default true), model }` —
and surface them on `describe_field` so a reader can see what an existing agent is set to.

## F8 — `update_dashboard_widget` replaces `params` wholesale, so a partial patch is rejected (P20)

> **FIXED 1.0.3 — params merged; verified live: partial patch kept all 15 keys and the data source**

**Severity: high.** Changing one chart setting is impossible without resupplying the entire params
blob. Patching only `chart_type`:

```
update_dashboard_widget({ widgetId, params: { chart_type: 'bar' } })
-> 400 {"values":["Field required"],"group_by":["Field required"],
        "totals":["Field required"],"benchmarks":["Field required"], ...}
```

This is precisely the source document's P20 "Watch for" — *"the widget's source lost because params
were replaced wholesale"* — except it fails loudly with a 400 rather than silently, which is the
better of the two outcomes. A caller who resupplies a *plausible-looking* full blob would instead
succeed and quietly drop the data source.

**Fix:** merge the patch onto the widget's existing params (read-modify-write), the way
`update_field` already merges field params via `mergeFieldParams`. The plumbing pattern exists in
the codebase; the widget path just doesn't use it.

## F9 — Widget types with no auto-fill template fail on undocumented required params (P18, P23)

> **FIXED 1.0.3 (documented) — required params named per type; templates still not extended**

**Severity: medium.** 0.9.5 shipped auto-fill templates for 19 widget types; 0.9.7 added six more
"with no auto-fill param template yet — supply `params`". Nothing says *which* params, so the
caller learns by 400:

```
countdown-widget   -> 400 target_date, target_time (+ display_* flags) required;
                          target_time wants a full YYYY-MM-DDThh:mm datetime, not "09:00"
heading-widget     -> 400 content required
text-block-widget  -> 400 content required, and "Expected a dictionary" — it must be a
                          ProseMirror doc, not a string
```

`progress-widget` created fine, so the gap is per-type rather than across the board.

**Fix:** two parts. (a) Extend the template catalogue to the remaining types so they create from
`widgetType` alone, as the other 19 do. (b) Until then, name the required params per type in the
tool description — the same discoverability fix applied to `countfield` and needed for `ai_agent`
(F7). The content widgets should also accept a plain string and build the ProseMirror doc, exactly
as `create_comment` now does.

## F10 — Automation trigger shapes are only learnable from an automation you already have (P27)

> **FIXED 1.0.3 (documented) — the new-solution bootstrap problem called out**

**Severity: low, but it bites hardest on a new build.** `create_automation` requires
`trigger.trigger_reference.trigger_id` plus per-trigger `inputs`, and the documented way to
discover those is *"use `describe_automation_step` on a similar existing automation to learn the
exact trigger/action/input shapes and option values."*

A brand-new solution — exactly the case in the test sequence, and in the CEO's three-table
build — has no similar automation to copy from. The caller is left guessing at a structured
payload, and the failure is a 400 naming one missing key at a time.

To its credit the error is precise (`trigger.trigger_reference.trigger_id is required`), so this
is friction rather than a trap.

**Fix:** ship a small catalogue of trigger_id values and their required inputs in the tool
description (the same treatment the widget templates got in 0.9.5), or add a
`list_automation_triggers` read tool. Lower priority than F1–F9.
