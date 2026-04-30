import net from "node:net";
import {
  UI_LOOPBACK_BIND_HOSTS,
  type UiLoopbackBindHost,
} from "./ui-host-launch";

export interface ReservedLoopbackPort {
  port: number;
  close: () => Promise<void>;
}

export type ReserveLoopbackPortResult =
  | {
      ok: true;
      reservation: ReservedLoopbackPort;
    }
  | {
      ok: false;
    };

export async function reserveLoopbackPort(
  host: string,
  port: number,
): Promise<ReserveLoopbackPortResult> {
  return new Promise((resolve) => {
    const server = net.createServer();
    const close = async () => {
      await new Promise<void>((closeResolve) => {
        server.close(() => closeResolve());
      });
    };
    server.once("error", () => resolve({ ok: false }));
    server.listen(port, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        void close().then(() => resolve({ ok: false }));
        return;
      }
      resolve({
        ok: true,
        reservation: {
          port: address.port,
          close,
        },
      });
    });
  });
}

export async function resolveAvailableLoopbackBindHosts(): Promise<
  UiLoopbackBindHost[]
> {
  const availableHosts: UiLoopbackBindHost[] = [];
  for (const host of UI_LOOPBACK_BIND_HOSTS) {
    const reservation = await reserveLoopbackPort(host, 0);
    if (!reservation.ok) {
      continue;
    }
    await reservation.reservation.close();
    availableHosts.push(host);
  }
  return availableHosts;
}

export async function canReserveLoopbackPortOnHosts(
  port: number,
  bindHosts: readonly UiLoopbackBindHost[],
): Promise<boolean> {
  for (const host of bindHosts) {
    const reservation = await reserveLoopbackPort(host, port);
    if (!reservation.ok) {
      return false;
    }
    await reservation.reservation.close();
  }
  return true;
}
