export type EmailPort = {
  enviarConfirmacaoPedido(input: {
    para: string;
    pedidoId: string;
    totalCentavos: number;
  }): Promise<void>;
};

export function createFakeEmail(): EmailPort {
  return {
    async enviarConfirmacaoPedido(input) {
      console.info(
        `confirmacao-pedido para=${input.para} pedido=${input.pedidoId} total=${input.totalCentavos}`,
      );
    },
  };
}
