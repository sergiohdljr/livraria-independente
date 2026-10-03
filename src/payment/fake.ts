export type PaymentStatus = "accepted" | "declined";

export type Charge = {
  status: PaymentStatus;
  amountCents: number;
};

export type PaymentPort = {
  charge(input: { amountCents: number; simulate?: PaymentStatus }): Promise<Charge>;
};

export function createFakePayment(): PaymentPort {
  return {
    async charge({ amountCents, simulate }) {
      return {
        status: simulate === "declined" ? "declined" : "accepted",
        amountCents,
      };
    },
  };
}
