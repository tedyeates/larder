# Larder Core — dependency graph

Parent spec: [#1](https://github.com/tedyeates/larder/issues/1)

Batches are computed from blocking edges: everything in a batch can run in parallel once the
previous batches are closed.

```mermaid
graph LR
  subgraph "Batch 1"
    T2["#2 Foundation"]
  end
  subgraph "Batch 2"
    T3["#3 Ingredient Registry"]
    T4["#4 Preferences"]
  end
  subgraph "Batch 3"
    T5["#5 Pantry"]
    T6["#6 Shops, Aisles and Placements"]
  end
  subgraph "Batch 4"
    T7["#7 Recipes"]
    T8["#8 Shopping List"]
    T9["#9 Deterministic import"]
  end
  subgraph "Batch 5"
    T10["#10 Cook and eat, off-plan"]
    T11["#11 Shopping gestures"]
    T12["#12 Recipe import and parser"]
  end
  subgraph "Batch 6"
    T13["#13 Meal Plan, by hand"]
  end
  subgraph "Batch 7"
    T14["#14 Agent Gateway: tokens and MCP reads"]
  end
  subgraph "Batch 8"
    T15["#15 Plan Proposals and Plan Check"]
  end
  subgraph "Batch 9"
    T16["#16 Planner chat and Agent Runner"]
    T17["#17 End-to-end cascade"]
  end

  T2 --> T3
  T2 --> T4
  T3 --> T5
  T3 --> T6
  T5 --> T7
  T5 --> T8
  T6 --> T8
  T6 --> T9
  T7 --> T10
  T7 --> T11
  T8 --> T11
  T7 --> T12
  T9 --> T12
  T10 --> T13
  T13 --> T14
  T4 --> T14
  T8 --> T15
  T14 --> T15
  T15 --> T16
  T13 --> T17
  T15 --> T17
```

## Critical path

`#2 → #3 → #5 → #7 → #10 → #13 → #14 → #15 → #16`

Nine tickets deep. The length comes from the AI path sitting at the end: the planner can't be built
until there are Meal Slots to propose and a Shopping List to write to, which in turn need Recipes,
which need the Pantry and the Registry.

Both import tickets (#9, #12) sit off the critical path, so the existing 40 recipes and pantry can be
brought across in parallel with feature work rather than blocking it.

The app is genuinely useful well before the end: after `#13` you have manual planning, shopping,
pantry tracking, cooking and portion counting — everything except the AI.
