export type EmailPort = {
  sendOrderConfirmation(input: { to: string; orderId: string; totalCents: number }): Promise<void>;
};

export function createFakeEmail(): EmailPort {
  return {
    async sendOrderConfirmation(input) {
      console.info(
        `order-confirmation to=${input.to} order=${input.orderId} total=${input.totalCents}`,
      );
    },
  };
}
