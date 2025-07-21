export interface Alert {
  chatId: number;
  cryptoId: string;
  type: 'above' | 'below';
  price: number;
  active: boolean;
}