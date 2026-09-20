"use client";

import React, { useState } from "react";
import type { EventType } from "@/app/(dashboard)/_dashboard/_data/types";
import AddEventModal from "@/app/(dashboard)/_dashboard/_components/AddEventModal";

// Smart Goals used to have its own add-event window with its own categories,
// writing to its own table. Two windows, two stores, one concept. This is the
// dashboard's window, writing where the dashboard writes, so an event added on
// either side shows up on both timelines. It now also edits and deletes, the
// same way the dashboard does — same modal, same endpoints.

/** An existing event being edited, from a clicked timeline marker. */
export interface EditableEvent {
  id: string;
  category: string;
  startDate: string;
  endDate?: string;
  title: string;
  desc?: string;
}

const EVENT_TYPES: EventType[] = ["promotions", "website", "products", "custom"];
/** The dashboard's own coercion: an event on a category the picker doesn't have
 *  (or none) edits as "custom" rather than blocking. */
const asEventType = (c?: string): EventType =>
  EVENT_TYPES.includes(c as EventType) ? (c as EventType) : "custom";

export default function AddCustomEventModal({
  defaultDate,
  editEvent,
  onClose,
  onCreated,
  onDeleted,
  createdBy,
}: {
  /** The day the timeline was opened from, or the first day of the period. */
  defaultDate: string;
  /** Set to edit an existing event instead of creating one. */
  editEvent?: EditableEvent | null;
  onClose: () => void;
  onCreated: () => void;
  /** Called after a successful delete, so the caller can refresh. */
  onDeleted?: () => void;
  /** Stored as "Created By", the same as on the dashboard. */
  createdBy?: string;
}) {
  const [type, setType] = useState<EventType>(asEventType(editEvent?.category));
  const [startDate, setStartDate] = useState(editEvent?.startDate ?? defaultDate);
  const [endDate, setEndDate] = useState(editEvent?.endDate ?? "");
  const [title, setTitle] = useState(editEvent?.title ?? "");
  const [desc, setDesc] = useState(editEvent?.desc ?? "");

  const submit = async () => {
    if (!title.trim() || !startDate) return;
    onClose();
    if (editEvent) {
      await fetch(`/api/custom-events/${encodeURIComponent(editEvent.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: type, startDate, endDate, title: title.trim(), desc }),
      }).catch(() => {});
    } else {
      await fetch("/api/custom-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: type,
          type: createdBy || "You",
          startDate,
          endDate,
          title: title.trim(),
          desc,
        }),
      }).catch(() => {});
    }
    onCreated();
  };

  const remove = async () => {
    if (!editEvent) return;
    onClose();
    await fetch(`/api/custom-events/${encodeURIComponent(editEvent.id)}`, {
      method: "DELETE",
    }).catch(() => {});
    onDeleted?.();
  };

  return (
    <AddEventModal
      evtType={type}
      evtStartDate={startDate}
      evtEndDate={endDate}
      evtTitle={title}
      evtDesc={desc}
      editing={!!editEvent}
      onClose={onClose}
      onSubmit={submit}
      onDelete={editEvent ? remove : undefined}
      onTypeChange={setType}
      onStartDateChange={setStartDate}
      onEndDateChange={setEndDate}
      onTitleChange={setTitle}
      onDescChange={setDesc}
    />
  );
}
