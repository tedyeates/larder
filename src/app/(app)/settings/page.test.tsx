import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import SettingsPage from "./page";
import type { Preference } from "@/lib/preferences/types";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

const listPreferences = vi.fn();
const createPreference = vi.fn();
const updatePreference = vi.fn();
const deletePreference = vi.fn();

vi.mock("@/lib/preferences/preferences", () => ({
  listPreferences: (...args: unknown[]) => listPreferences(...args),
  createPreference: (...args: unknown[]) => createPreference(...args),
  updatePreference: (...args: unknown[]) => updatePreference(...args),
  deletePreference: (...args: unknown[]) => deletePreference(...args),
}));

const noRepeat: Preference = {
  id: "p1",
  category: "variety",
  body: "Don't repeat a recipe within four weeks",
  updatedAt: "2026-01-05T00:00:00Z",
};

const lactoseFree: Preference = {
  id: "p2",
  category: "diet",
  body: "Lactose free",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("SettingsPage (Preferences)", () => {
  beforeEach(() => {
    listPreferences.mockReset().mockResolvedValue([noRepeat, lactoseFree]);
    createPreference.mockReset();
    updatePreference.mockReset();
    deletePreference.mockReset();
  });

  it("renders without crashing and shows loaded Preferences in the returned order", async () => {
    render(<SettingsPage />);

    expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Don't repeat a recipe within four weeks")).toBeInTheDocument();
    });
    expect(screen.getByText("Lactose free")).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Don't repeat a recipe within four weeks")).toBeInTheDocument();
    expect(within(items[1]).getByText("Lactose free")).toBeInTheDocument();
  });

  it("shows an empty state when there are no Preferences", async () => {
    listPreferences.mockResolvedValue([]);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("preferences-empty")).toBeInTheDocument();
    });
  });

  it("shows an error state when loading fails", async () => {
    listPreferences.mockRejectedValue(new Error("network down"));
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("network down");
    });
  });

  it("creates a Preference with a body and optional category", async () => {
    createPreference.mockResolvedValue({
      id: "p3",
      category: "cadence",
      body: "Max three cooks a week",
      updatedAt: "2026-01-06T00:00:00Z",
    });
    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByText("Lactose free")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Preference"), {
      target: { value: "Max three cooks a week" },
    });
    fireEvent.change(screen.getByLabelText("Category (optional)"), {
      target: { value: "cadence" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add preference/i }));

    await waitFor(() => {
      expect(createPreference).toHaveBeenCalledWith(
        {},
        { body: "Max three cooks a week", category: "cadence" }
      );
    });
    expect(listPreferences).toHaveBeenCalledTimes(2);
  });

  it("creates a Preference with no category as null", async () => {
    createPreference.mockResolvedValue({
      id: "p4",
      category: null,
      body: "Favour older stock",
      updatedAt: "2026-01-06T00:00:00Z",
    });
    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByText("Lactose free")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Preference"), {
      target: { value: "Favour older stock" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add preference/i }));

    await waitFor(() => {
      expect(createPreference).toHaveBeenCalledWith(
        {},
        { body: "Favour older stock", category: null }
      );
    });
  });

  it("edits a Preference's body and category", async () => {
    updatePreference.mockResolvedValue({ ...lactoseFree, body: "Dairy free" });
    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByText("Lactose free")).toBeInTheDocument());

    const row = screen.getByText("Lactose free").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: /edit/i }));

    const bodyInput = within(row).getByDisplayValue("Lactose free");
    fireEvent.change(bodyInput, { target: { value: "Dairy free" } });
    fireEvent.click(within(row).getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(updatePreference).toHaveBeenCalledWith(
        {},
        "p2",
        { body: "Dairy free", category: "diet" }
      );
    });
  });

  it("deletes a Preference", async () => {
    deletePreference.mockResolvedValue(undefined);
    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByText("Lactose free")).toBeInTheDocument());

    const row = screen.getByText("Lactose free").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(deletePreference).toHaveBeenCalledWith({}, "p2");
    });
  });
});
