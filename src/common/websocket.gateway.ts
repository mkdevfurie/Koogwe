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

    await this.prisma.driverProfile
      .update({ where: { userId }, data: { isOnline: data.availability === 'ONLINE' } })
      .catch(() => {});
  }

  @SubscribeMessage('ride:join')
  handleJoinRide(@ConnectedSocket() client: Socket, @MessageBody() data: { rideId: string }) {
    const userId = (client as any).userId;
    if (!userId || !data.rideId) return;
    client.join(`ride:${data.rideId}`);
  }

  @SubscribeMessage('ride:accept')
  async handleRideAccept(@ConnectedSocket() client: Socket, @MessageBody() data: { rideId: string }) {
    const driverId = (client as any).userId;
    if (!driverId || !data.rideId) return;

    try {
      const ride = await this.prisma.ride.findUnique({ where: { id: data.rideId } });
      if (!ride || ride.status !== 'REQUESTED') return;

      await this.prisma.ride.update({
        where: { id: data.rideId },
        data: { driverId, status: 'ACCEPTED', acceptedAt: new Date() },
      });

      const driver = await this.prisma.user.findUnique({
        where: { id: driverId },
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          avatarUrl: true,
          driverProfile: true,
        },
      });

      this.server.to(`ride:${data.rideId}`).emit('ride:accepted', {
        rideId: data.rideId,
        driverId,
        status: 'ACCEPTED',
        driver: {
          name: `${driver?.firstName ?? ''} ${driver?.lastName ?? ''}`.trim(),
          phone: driver?.phone,
          avatarUrl: driver?.avatarUrl,
          plate: driver?.driverProfile?.licensePlate,
          vehicle: `${driver?.driverProfile?.vehicleMake ?? ''} ${driver?.driverProfile?.vehicleModel ?? ''}`.trim(),
          rating: driver?.driverProfile?.rating,
        },
      });

      // Notifier aussi le passager via ride:status
      this.server.to(`ride:${data.rideId}`).emit('ride:status', {
        rideId: data.rideId,
        status: 'ACCEPTED',
      });
    } catch (e) {
      this.logger.error(`ride:accept error: ${e}`);
    }
  }

  // === Mise à jour de statut depuis le client (annulation, etc.) ===
  @SubscribeMessage('ride:status')
  async handleRideStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { rideId: string; status: string },
  ) {
    const userId = (client as any).userId;
    if (!userId || !data.rideId || !data.status) return;

    try {
      const ride = await this.prisma.ride.findUnique({ where: { id: data.rideId } });
      if (!ride) return;
      if (ride.passengerId !== userId && ride.driverId !== userId) return;

      await this.prisma.ride.update({
        where: { id: data.rideId },
        data: {
          status: data.status as any,
          ...(data.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
          ...(data.status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
        },
      });

      this.server.to(`ride:${data.rideId}`).emit('ride:status', {
        rideId: data.rideId,
        status: data.status,
      });
    } catch (e) {
      this.logger.error(`ride:status error: ${e}`);
    }
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