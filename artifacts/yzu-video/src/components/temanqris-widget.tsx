import { useEffect, useRef } from "react";

interface TemanQrisWidgetProps {
  merchantId: string;
  userId?: string;
  buttonText?: string;
  buttonColor?: string;
}

/**
 * TemanQRIS embedded payment widget.
 *
 * Loads the TemanQRIS widget.js script which renders a "Bayar dengan QRIS"
 * button. When clicked, it opens the QRIS payment flow where the user enters
 * the nominal (since data-amount is omitted) and completes the payment.
 *
 * The webhook URL is set so TemanQRIS sends server-to-server confirmation to
 * our backend, which credits the wallet. The user ID is embedded in the
 * description so the webhook handler can associate the payment with a user
 * (the widget creates the order client-side; the backend has no pre-existing
 * topup record).
 */
export function TemanQrisWidget({
  merchantId,
  userId,
  buttonText = "Top Up Sekarang",
  buttonColor = "#7C3AED",
}: TemanQrisWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ merchantId, userId, buttonText, buttonColor });
  propsRef.current = { merchantId, userId, buttonText, buttonColor };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { merchantId, userId, buttonText, buttonColor } = propsRef.current;

    const script = document.createElement("script");
    script.src = "https://temanqris.com/widget.js";
    script.async = true;
    script.setAttribute("data-merchant", merchantId);
    // No data-amount — user enters the nominal in the QRIS payment flow.
    script.setAttribute("data-button-text", buttonText);
    script.setAttribute("data-button-color", buttonColor);
    script.setAttribute("data-description", `Top Up Wallet user:${userId ?? ""}`);
    script.setAttribute("data-callback", `${window.location.origin}/topup`);
    script.setAttribute(
      "data-webhook",
      `${window.location.origin}/api/webhooks/temanqris`,
    );

    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, []);

  return <div ref={containerRef} className="temanqris-widget-container" />;
}
