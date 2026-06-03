import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBadge } from "@/components/status-badge";

/**
 * The status badge renders `suspended` as the display label "Stopped"
 * (remote-dev-jvcx.15) while leaving every other status' text equal to its
 * value. Only the DISPLAY text changes — the underlying status is unchanged.
 */
describe("StatusBadge", () => {
  it("renders 'suspended' as the label 'Stopped'", () => {
    const html = renderToStaticMarkup(<StatusBadge status="suspended" />);
    expect(html).toContain("Stopped");
    expect(html).not.toMatch(/>suspended</);
  });

  it("renders other statuses with their raw value", () => {
    for (const status of ["ready", "provisioning", "requested", "terminating", "deleted", "error"]) {
      const html = renderToStaticMarkup(<StatusBadge status={status} />);
      expect(html).toContain(status);
    }
  });
});
