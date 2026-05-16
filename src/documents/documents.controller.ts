// src/documents/documents.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Uploader un document (base64)' })
  upload(@Request() req: any, @Body() body: { type: string; imageBase64: string }) {
    return this.documentsService.uploadBase64Document({ userId: req.user.id, type: body.type, imageBase64: body.imageBase64 });
  }

  @Get('admin/pending')
  @Roles('ADMIN') @UseGuards(RolesGuard)
  getPending() { return this.documentsService.listPendingDocuments(); }

  @Get('admin/approved')
  @Roles('ADMIN') @UseGuards(RolesGuard)
  getApproved() { return this.documentsService.listApprovedDocuments(); }

  @Get('admin')
  @Roles('ADMIN') @UseGuards(RolesGuard)
  getByStatus(@Query('status') status?: string) { return this.documentsService.getDocumentsByStatus(status); }

  @Patch('admin/:id/review')
  @Roles('ADMIN') @UseGuards(RolesGuard)
  review(@Request() req: any, @Param('id') id: string, @Body() body: { status?: string; approved?: boolean; rejectionReason?: string }) {
    return this.documentsService.reviewDocument({ documentId: id, adminId: req.user.id, ...body });
  }

  @Post('admin/:id/approve')
  @Roles('ADMIN') @UseGuards(RolesGuard)
  approve(@Request() req: any, @Param('id') id: string) {
    return this.documentsService.reviewDocument({ documentId: id, adminId: req.user.id, status: 'APPROVED' });
  }

  @Post('admin/:id/reject')
  @Roles('ADMIN') @UseGuards(RolesGuard)
  reject(@Request() req: any, @Param('id') id: string, @Body() body: { rejectionReason?: string }) {
    return this.documentsService.reviewDocument({ documentId: id, adminId: req.user.id, status: 'REJECTED', rejectionReason: body.rejectionReason });
  }

  @Patch('admin/drivers/:driverId/decision')
  @Roles('ADMIN') @UseGuards(RolesGuard)
  decideDriver(@Request() req: any, @Param('driverId') driverId: string, @Body() body: { approved: boolean; adminNotes?: string }) {
    return this.documentsService.decideDriverAccount({ driverId, adminId: req.user.id, approved: body.approved, adminNotes: body.adminNotes });
  }
}
