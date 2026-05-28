import { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  Button,
  ErrorBanner,
  H1,
  InfoBanner,
  Screen,
  Sub,
} from '../../../src/components/ui';
import { trpc } from '../../../src/lib/trpc';

/**
 * Scan-receipt screen. Lets the user pick (or capture) an image, downscales it
 * on-device, requests a presigned upload URL, PUTs the bytes direct to S3/R2,
 * enqueues an OCR job, and navigates to the itemize editor.
 *
 * We intentionally downscale to ~1600 px before upload — it cuts VPS-bound
 * bandwidth and matches what the worker preprocessor will resize to anyway.
 */
const MAX_DIM = 1600;
const COMPRESS = 0.8;

export default function ScanReceiptScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = String(params.groupId);

  const [localUri, setLocalUri] = useState<string | null>(null);
  const [byteSize, setByteSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<
    'idle' | 'preparing' | 'requesting' | 'uploading' | 'enqueuing' | 'done'
  >('idle');

  const createUrl = trpc.receipts.createUploadUrl.useMutation();
  const enqueue = trpc.receipts.enqueue.useMutation();

  async function prepareImage(uri: string): Promise<{ uri: string; size: number }> {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: MAX_DIM } }],
      { compress: COMPRESS, format: ImageManipulator.SaveFormat.JPEG },
    );
    // Fetch the blob to learn byte size — Image Manipulator doesn't return it.
    const res = await fetch(result.uri);
    const blob = await res.blob();
    return { uri: result.uri, size: blob.size };
  }

  async function pickFromLibrary() {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo library access is required to pick a receipt.');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      allowsEditing: false,
    });
    if (r.canceled) return;
    setStage('preparing');
    try {
      const prepared = await prepareImage(r.assets[0]!.uri);
      setLocalUri(prepared.uri);
      setByteSize(prepared.size);
      setStage('idle');
    } catch (e) {
      setStage('idle');
      setError(e instanceof Error ? e.message : 'Failed to prepare image.');
    }
  }

  async function captureWithCamera() {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('Camera access is required to snap a receipt.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({
      quality: 1,
      allowsEditing: false,
    });
    if (r.canceled) return;
    setStage('preparing');
    try {
      const prepared = await prepareImage(r.assets[0]!.uri);
      setLocalUri(prepared.uri);
      setByteSize(prepared.size);
      setStage('idle');
    } catch (e) {
      setStage('idle');
      setError(e instanceof Error ? e.message : 'Failed to prepare image.');
    }
  }

  async function uploadAndEnqueue() {
    if (!localUri || !byteSize) return;
    setError(null);
    try {
      setStage('requesting');
      const presigned = await createUrl.mutateAsync({
        contentType: 'image/jpeg',
        byteSize,
      });

      setStage('uploading');
      const res = await fetch(localUri);
      const blob = await res.blob();
      const put = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: blob,
      });
      if (!put.ok) throw new Error(`upload failed: ${put.status}`);

      setStage('enqueuing');
      await enqueue.mutateAsync({ receiptScanId: presigned.receiptScanId });
      setStage('done');
      router.replace({
        pathname: '/groups/[groupId]/itemize/[receiptScanId]',
        params: { groupId, receiptScanId: presigned.receiptScanId },
      });
    } catch (e) {
      setStage('idle');
      setError(e instanceof Error ? e.message : 'Upload failed.');
    }
  }

  const busy = stage !== 'idle' && stage !== 'done';

  return (
    <Screen>
      <ScrollView contentContainerClassName="pb-10">
        <Button variant="ghost" onPress={() => router.back()}>
          ← Cancel
        </Button>
        <View className="mt-2">
          <H1>Scan a receipt</H1>
          <Sub>Snap a photo or pick one from your library. We&apos;ll extract the line items.</Sub>
        </View>

        <View className="mt-6 gap-3">
          <Button onPress={captureWithCamera} disabled={busy}>
            📸 Open camera
          </Button>
          <Button variant="ghost" onPress={pickFromLibrary} disabled={busy}>
            🖼  Choose from library
          </Button>
        </View>

        {localUri ? (
          <View className="mt-6 gap-3">
            <InfoBanner kind="info">
              Preview · {(byteSize ?? 0) > 0 ? `${Math.round((byteSize ?? 0) / 1024)} KB` : ''}
            </InfoBanner>
            <Image
              source={{ uri: localUri }}
              className="h-80 w-full rounded-md bg-slate-200"
              resizeMode="contain"
            />
            <Button onPress={uploadAndEnqueue} disabled={busy} loading={busy}>
              {stage === 'requesting'
                ? 'Requesting upload URL…'
                : stage === 'uploading'
                  ? 'Uploading…'
                  : stage === 'enqueuing'
                    ? 'Queueing OCR…'
                    : 'Upload & extract items'}
            </Button>
          </View>
        ) : stage === 'preparing' ? (
          <View className="mt-6 flex-row items-center gap-2">
            <ActivityIndicator />
            <Text className="text-sm text-slate-600">Preparing image…</Text>
          </View>
        ) : null}

        <View className="mt-4">
          <ErrorBanner error={error} />
        </View>
      </ScrollView>
    </Screen>
  );
}
