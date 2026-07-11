<template>
    <div>
        <v-btn v-if="videoFiles.length > 0" color="teal white--text" v-on:click="openDialog" class="ma-1">
            <v-icon left dark>mdi-image-refresh</v-icon>
            THUMB
        </v-btn>
        <v-dialog v-model="isOpened" max-width="420" scrollable>
            <v-card>
                <v-card-title>サムネイル再生成</v-card-title>
                <v-card-text>
                    <div class="body-2 mb-3">選んだ録画ファイルタイプを元にサムネイルを再生成します。</div>
                    <v-select v-model="selectedVideoFileId" :items="videoFileItems" dense :menu-props="{ auto: true }"></v-select>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="primary" text v-on:click="isOpened = false">キャンセル</v-btn>
                    <v-btn color="primary" text :disabled="selectedVideoFileId === null" v-on:click="replace">再生成</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import IThumbnailApiModel from '@/model/api/thumbnail/IThumbnailApiModel';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../../api';

interface SelectItem {
    text: string;
    value: apid.VideoFileId;
}

@Component({})
export default class RecordedDetailThumbnailButton extends Vue {
    @Prop({ required: true })
    public videoFiles!: apid.VideoFile[];

    public isOpened: boolean = false;
    public selectedVideoFileId: apid.VideoFileId | null = null;

    private thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    get videoFileItems(): SelectItem[] {
        return this.videoFiles.map(video => {
            return {
                text: video.name,
                value: video.id,
            };
        });
    }

    public openDialog(): void {
        this.selectedVideoFileId = this.videoFiles.length === 0 ? null : this.videoFiles[0].id;
        this.isOpened = true;
    }

    public async replace(): Promise<void> {
        if (this.selectedVideoFileId === null) {
            return;
        }

        this.isOpened = false;

        try {
            await this.thumbnailApiModel.replace(this.selectedVideoFileId);
            this.snackbarState.open({
                color: 'success',
                text: 'サムネイル再生成を開始',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: 'サムネイル再生成に失敗',
            });
            console.error(err);
        }
    }
}
</script>
