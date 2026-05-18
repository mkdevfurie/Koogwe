// src/common/websocket.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      const allowedOrigins = [
        'https://admin-koogwe-rho.vercel.app',
        'https://admin-koogwe.vercel.app',
        ...(process.env.FRONTEND_URLS ? process.env.FRONTEND_URLS.split(',').map((u) => u.trim()) : []),
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:8080',
        'http://localhost:4173',
      ].filter(Boolean);

      const isVercelPreview = origin && /^https:\/\/admin-koogwe[a-z0-9-]*\.vercel\.app$/.test(origin);

      if (!origin || allowedOrigins.includes(origin) || isVercelPreview) return callback(null, true);
      callback(new Error(`CORS WebSocket bloqué: ${origin}`));
    },
    credentials: true,
  },
  namespace: '/',
})
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AppGateway.name);
  @WebSocketServer() server: Server;

  private connectedUsers = new Map<string, string>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');

      if (!token) throw new Error('No token');

      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
      });

      const userId = payload.sub || payload.userId;
      if (!userId) throw new Error('Invalid payload');

      (client as any).userId = userId;
      this.connectedUsers.set(userId, client.id);
      client.join(`user:${userId}`);

      this.prisma.user
        .findUnique({ where: { id: userId }, select: { role: true } })
        .then((user) => {
          if (user?.role === 'ADMIN') {
            client.join('admin');
            this.logger.log(`Admin ${userId} joined room admin`);
          }
        })
        .catch(() => {});

      // ✅ FIX #6 : Si le chauffeur est déjà en ligne, le faire rejoindre sa room automatiquement
      this.prisma.driverProfile.findUnique({
        where: { userId },
        select: { isOnline: true, vehicleType: true }
      }).then(profile => {
        if (profile?.isOnline && profile?.vehicleType) {
          const room = `drivers:${profile.vehicleType}`;
          client.join(room);
          this.logger.log(`Driver ${userId} auto-joined room ${room}`);
        }
      }).catch(() => {});

      this.logger.log(`✅ WebSocket connecté → userId=${userId} | socket=${client.id}`);
    } catch (e) {
      this.logger.warn(`Connexion refusée - token invalide (${client.id})`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = (client as any).userId;
    if (userId) this.connectedUsers.delete(userId);
    this.logger.log(`❌ Déconnecté : socket=${client.id}`);
  }

  @SubscribeMessage('driver:location')
  async handleDriverLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; heading?: number; rideId?: string },
  ) {
    const userId = (client as any).userId;
    if (!userId) return;

    await this.prisma.driverProfile
      .update({
        where: { userId },
        data: {
          currentLat: data.lat,
          currentLng: data.lng,
          heading: data.heading ?? null,
          lastLocationAt: new Date(),
        },
      })
      .catch(() => {});

    if (data.rideId) {
      this.server.to(`ride:${data.rideId}`).emit('driver:location', {
        driverId: userId,
        lat: data.lat,
        lng: data.lng,
        heading: data.heading ?? null,
      });
    }
  }

  @SubscribeMessage('driver:availability')
  async handleAvailability(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { availability: 'ONLINE' | 'OFFLINE' },
  ) {
    const userId = (client as any).userId;
    if (!userId) return;

    try {
      const profile = await this.prisma.driverProfile.update({
        where: { userId },
        data: { isOnline: data.availability === 'ONLINE' },
        select: { vehicleType: true },
      });

      if (profile?.vehicleType) {
        const room = `drivers:${profile.vehicleType}`;
        if (data.availability === 'ONLINE') {
          client.join(room);
          this.logger.log(`Driver ${userId} went ONLINE: joined room ${room}`);
        } else {
          client.leave(room);
          this.logger.log(`Driver ${userId} went OFFLINE: left room ${room}`);
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to update availability for driver ${userId}: ${e}`);
    }
  }

  @SubscribeMessage('ride:join')
  handleJoinRide(@ConnectedSocket() client: Socket, @MessageBody() data: { rideId: string }) {
    const userId = (client as any).userId;
    if (!userId || !data.rideId) return;
    client.join(`ride:${data.rideId}`);
  }

  // === Chat en temps réel entre passager et chauffeur ===
  @SubscribeMessage('chat:message')
  async handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { rideId: string; message: string },
  ) {
    const userId = (client as any).userId;
    if (!userId || !data.rideId || !data.message) return;

    try {
      const ride = await this.prisma.ride.findUnique({ where: { id: data.rideId } });
      if (!ride) return;
      if (ride.passengerId !== userId && ride.driverId !== userId) return;

      this.server.to(`ride:${data.rideId}`).emit('chat:message', {
        rideId: data.rideId,
        senderId: userId,
        message: data.message,
        sentAt: new Date().toISOString(),
      });
    } catch (e) {
      this.logger.error(`chat:message error: ${e}`);
    }
  }
}