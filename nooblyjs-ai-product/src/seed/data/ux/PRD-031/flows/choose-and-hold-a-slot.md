---
id: choose-and-hold-a-slot
itemId: PRD-031
title: Choose and hold a slot
version: 1
draftedBy: { id: design-agent, name: Design agent, kind: agent }
updatedAt: 2026-10-08T17:20:00.000Z
nodes:
  - { id: home, kind: screen, label: Home }
  - { id: picker, kind: screen, label: Store & slot picker }
  - { id: free, kind: decision, label: Slot free? }
  - { id: hold, kind: screen, label: Hold · 15 min }
  - { id: pay, kind: screen, label: Basket → Pay }
  - { id: alternatives, kind: screen, label: Next-best slots & nearby stores }
edges:
  - { from: home, to: picker, label: null }
  - { from: picker, to: free, label: null }
  - { from: free, to: hold, label: 'yes' }
  - { from: hold, to: pay, label: null }
  - { from: free, to: alternatives, label: 'no' }
sampleData: true
---
