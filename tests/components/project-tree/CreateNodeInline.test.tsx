import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CreateNodeInline } from "@/components/session/project-tree/CreateNodeInline";

describe("CreateNodeInline", () => {
  it("renders a text input autofocused", () => {
    render(<CreateNodeInline depth={0} kind="group" onSubmit={async () => {}} onCancel={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it("uses kind-appropriate aria-label", () => {
    render(<CreateNodeInline depth={0} kind="project" onSubmit={async () => {}} onCancel={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-label", "New project name");
  });

  it("calls onSubmit with trimmed value on Enter", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CreateNodeInline depth={0} kind="project" onSubmit={onSubmit} onCancel={() => {}} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  new-proj  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("new-proj"));
  });

  it("does not double-submit when Enter then blur fire", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CreateNodeInline depth={0} kind="project" onSubmit={onSubmit} onCancel={() => {}} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("cancels (not submits) on Enter with empty value", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<CreateNodeInline depth={0} kind="group" onSubmit={onSubmit} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("cancels on Escape without submitting (and no double-cancel on blur)", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<CreateNodeInline depth={0} kind="group" onSubmit={onSubmit} onCancel={onCancel} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "typed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("submits on blur with a valid value", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CreateNodeInline depth={0} kind="group" onSubmit={onSubmit} onCancel={() => {}} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "valid" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("valid"));
  });

  it("cancels on blur when value is empty", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<CreateNodeInline depth={0} kind="group" onSubmit={onSubmit} onCancel={onCancel} />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
