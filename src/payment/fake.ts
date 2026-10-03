export type PagamentoStatus = "aceito" | "recusado";

export type Cobranca = {
  status: PagamentoStatus;
  valorCentavos: number;
};

export type PaymentPort = {
  cobrar(input: { valorCentavos: number; simular?: PagamentoStatus }): Promise<Cobranca>;
};

export function createFakePayment(): PaymentPort {
  return {
    async cobrar({ valorCentavos, simular }) {
      return {
        status: simular === "recusado" ? "recusado" : "aceito",
        valorCentavos,
      };
    },
  };
}
