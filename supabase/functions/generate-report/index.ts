// ============================================================================
// LabOS — generate-report Edge Function
// POST /functions/v1/generate-report
//
// Body: { requestId: string }
//
// Generates a clean, branded PDF lab report for a released test request and
// returns it as a base64-encoded PDF. Used by both the referral doctor
// portal and the in-app "Download as PDF" buttons on results screens.
//
// Security: requires a valid user JWT (not service role) — RLS on the
// underlying tables ensures the caller can only generate reports for
// requests they're actually allowed to see (their own tenant, or a
// referral doctor's own patients).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jsPDF } from 'https://esm.sh/jspdf@2.5.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { requestId } = await req.json();
    if (!requestId) {
      return respond(400, { error: 'missing_request_id' });
    }

    // ── Client scoped to the calling user's JWT — RLS applies normally ──────
    const authHeader = req.headers.get('Authorization') || '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // ── Fetch the request, patient, tenant, and results ──────────────────────
    const { data: request, error: reqErr } = await supabase
      .from('test_requests')
      .select('id, display_id, patient_id, status, created_at, tenant_id')
      .eq('id', requestId)
      .single();

    if (reqErr || !request) {
      return respond(404, { error: 'request_not_found', message: 'Test request not found or you do not have access to it' });
    }

    const { data: patient } = await supabase
      .from('patients')
      .select('name, hospital_number, dob, gender')
      .eq('id', request.patient_id)
      .single();

    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, address, rc_number')
      .eq('id', request.tenant_id)
      .single();

    const { data: results } = await supabase
      .from('results')
      .select('test_name, test_code, value, unit, ref_range, flag, status')
      .eq('request_id', requestId)
      .order('test_name');

    // ── Build the PDF ──────────────────────────────────────────────────────
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 50;
    let y = 56;

    // Header — lab identity
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(47, 74, 109);
    doc.text(tenant?.name || 'Laboratory Report', margin, y);
    y += 18;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(107, 123, 145);
    if (tenant?.address) { doc.text(tenant.address, margin, y); y += 12; }
    if (tenant?.rc_number) { doc.text(`RC: ${tenant.rc_number}`, margin, y); y += 12; }

    doc.setDrawColor(221, 228, 238);
    doc.line(margin, y + 6, pageWidth - margin, y + 6);
    y += 26;

    // Report title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(26, 46, 72);
    doc.text('LABORATORY REPORT', margin, y);
    y += 24;

    // Patient details box
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(26, 46, 72);
    const patientLines = [
      [`Patient: ${patient?.name || 'Unknown'}`, `Hospital No: ${patient?.hospital_number || '—'}`],
      [`DOB: ${patient?.dob || '—'}`, `Gender: ${patient?.gender || '—'}`],
      [`Report ID: ${request.display_id || request.id}`, `Date: ${new Date(request.created_at).toLocaleDateString('en-GB')}`]
    ];
    patientLines.forEach(([left, right]) => {
      doc.text(left, margin, y);
      doc.text(right, margin + 260, y);
      y += 16;
    });
    y += 10;

    doc.line(margin, y, pageWidth - margin, y);
    y += 20;

    // Results table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(107, 123, 145);
    doc.text('TEST', margin, y);
    doc.text('RESULT', margin + 200, y);
    doc.text('UNIT', margin + 280, y);
    doc.text('REFERENCE RANGE', margin + 350, y);
    doc.text('FLAG', margin + 480, y);
    y += 8;
    doc.setDrawColor(221, 228, 238);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);

    for (const r of (results || [])) {
      if (y > 760) { doc.addPage(); y = 56; }
      doc.setTextColor(26, 46, 72);
      doc.text(String(r.test_name || r.test_code || ''), margin, y);

      const isAbnormal = r.flag && r.flag !== 'N';
      doc.setTextColor(isAbnormal ? 154 : 26, isAbnormal ? 31 : 46, isAbnormal ? 31 : 72);
      doc.setFont('helvetica', isAbnormal ? 'bold' : 'normal');
      doc.text(String(r.value ?? ''), margin + 200, y);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(107, 123, 145);
      doc.text(String(r.unit || ''), margin + 280, y);
      doc.text(String(r.ref_range || ''), margin + 350, y);

      if (isAbnormal) {
        doc.setTextColor(154, 31, 31);
        doc.setFont('helvetica', 'bold');
        doc.text(String(r.flag), margin + 480, y);
        doc.setFont('helvetica', 'normal');
      }
      y += 16;
    }

    if (!results || results.length === 0) {
      doc.setTextColor(155, 168, 184);
      doc.text('No results have been released for this request yet.', margin, y);
      y += 16;
    }

    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(155, 168, 184);
      doc.text(
        `Generated by LabOS · ${new Date().toISOString().slice(0,10)} · Page ${i} of ${pageCount} · This report is system-generated and does not require a signature unless otherwise stated.`,
        margin, 812
      );
    }

    const pdfBase64 = doc.output('datauristring').split(',')[1];

    return respond(200, {
      ok: true,
      filename: `LabOS-Report-${request.display_id || request.id}.pdf`,
      base64: pdfBase64
    });

  } catch (err) {
    console.error('generate-report error:', err);
    return respond(500, { error: 'internal_error', message: 'Could not generate report' });
  }
});

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
