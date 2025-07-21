export interface Alert {
  chatId: number;
  type: 'above' | 'below';
  price: number;
  active: boolean;
}