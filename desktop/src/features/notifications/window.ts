/**
 * A porta da janela de notificações (`notifications.html`), separada do `index.ts`: o index traz
 * o `NotificationsBridge`, que puxa a voz e o resto da janela principal. Pelo index, as duas
 * entradas do build dividiam esses módulos em chunks diferentes, com ciclo entre eles.
 */
export { NotificationStack } from "./components/NotificationStack";
