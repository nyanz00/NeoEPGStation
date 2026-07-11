<template>
    <div>
        <v-dialog v-if="isRemove === false" v-model="dialogModel" :persistent="isClearing" max-width="640" scrollable>
            <v-card v-if="isClearing === false">
                <v-card-text class="pa-4">
                    <div class="text--primary mb-3">クリーンアップは、まず削除候補リストを書き出します。ファイルを確認して、消したくない行を削除してから実行してください。</div>
                    <v-btn color="primary" text class="px-0" v-on:click="createPlan">候補リストを作成</v-btn>
                    <div v-if="plan !== null" class="mt-3">
                        <div class="text--primary">候補リスト:</div>
                        <v-text-field v-model="planPath" readonly dense hide-details></v-text-field>
                        <div class="caption mt-2">
                            録画ファイル: {{ plan.recordedFileCount }} 件 (EPGStation形式らしいもの {{ plan.epgstationLikeRecordedFileCount }} 件 / その他
                            {{ plan.otherRecordedFileCount }} 件)
                            <br />
                            空ディレクトリ候補: {{ plan.recordedDirectoryCount }} 件 / 実体の無い録画DB: {{ plan.missingVideoFileCount }} 件
                            <br />
                            drop log: {{ plan.dropLogFileCount }} 件 / 実体の無いdrop log DB: {{ plan.missingDropLogFileCount }} 件
                            <br />
                            thumbnail: {{ plan.thumbnailFileCount }} 件 / 実体の無いthumbnail DB: {{ plan.missingThumbnailFileCount }} 件
                        </div>
                    </div>
                    <v-divider class="my-4"></v-divider>
                    <div class="text--primary mb-2">編集済みの候補リストを実行</div>
                    <v-text-field v-model="planPath" label="候補リストのパス" clearable></v-text-field>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="primary" text v-on:click="dialogModel = false">キャンセル</v-btn>
                    <v-btn color="error" text :disabled="canExecute === false" v-on:click="openExecuteConfirm">リストを実行</v-btn>
                </v-card-actions>
            </v-card>
            <v-card v-else>
                <v-card-text class="pa-4">
                    <h3>{{ progressText }}</h3>
                    <v-progress-linear class="my-5" indeterminate rounded height="6"></v-progress-linear>
                </v-card-text>
            </v-card>
        </v-dialog>
        <v-dialog v-model="isExecuteConfirmOpen" max-width="440">
            <v-card>
                <v-card-title class="subtitle-1 font-weight-bold">クリーンアップ最終確認</v-card-title>
                <v-card-text>
                    <div class="cleanup-confirm-warning error--text font-weight-bold mb-3">
                        注意: 本当に削除しますか？
                        <br />
                        一度削除したファイルは元に戻せません。
                    </div>
                    <div class="caption text--secondary">実行する候補リスト:</div>
                    <v-text-field v-model="planPath" readonly dense hide-details></v-text-field>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="primary" text v-on:click="isExecuteConfirmOpen = false">キャンセル</v-btn>
                    <v-btn color="error" text v-on:click="executePlan">削除を実行</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class RecordedCleanupDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    public isRemove: boolean = false;
    public isClearing: boolean = false;
    public isExecuteConfirmOpen: boolean = false;
    public progressText: string = '';
    public plan: apid.RecordedCleanupPlanResult | null = null;
    public planPath: string | null = null;

    private recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private snackbarState = container.get<ISnackbarState>('ISnackbarState');

    /**
     * Prop で受け取った isOpen を直接は書き換えられないので
     * getter, setter を用意する
     */
    get dialogModel(): boolean {
        return this.isOpen;
    }
    set dialogModel(value: boolean) {
        this.$emit('update:isOpen', value);
    }

    get canExecute(): boolean {
        return typeof this.planPath === 'string' && this.planPath.length > 0;
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === false && oldState === true) {
            // close
            this.$nextTick(async () => {
                await Util.sleep(100);
                // dialog close アニメーションが終わったら要素を削除する
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                });
            });
        }
    }

    public async execute(): Promise<void> {
        await this.createPlan();
    }

    public openExecuteConfirm(): void {
        if (this.canExecute === false) {
            return;
        }

        this.isExecuteConfirmOpen = true;
    }

    public async createPlan(): Promise<void> {
        this.isClearing = true;
        this.progressText = '候補リスト作成中';

        let isSuccess = false;
        const now = new Date().getTime();
        try {
            this.plan = await this.recordedApiModel.createCleanupPlan();
            this.planPath = this.plan.planPath;
            isSuccess = true;
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: '候補リスト作成に失敗',
            });
        }

        // 1秒以上はプログレスバーを表示させる
        const diff = new Date().getTime() - now;
        if (diff < 1000) {
            await Util.sleep(1000 - diff);
        }

        if (isSuccess === true) {
            this.snackbarState.open({
                color: 'success',
                text: '候補リストを作成しました',
            });
        }

        this.isClearing = false;
    }

    public async executePlan(): Promise<void> {
        if (this.canExecute === false || this.planPath === null) {
            return;
        }

        this.isExecuteConfirmOpen = false;
        this.isClearing = true;
        this.progressText = 'クリーンアップ実行中';

        let result: apid.RecordedCleanupExecuteResult | null = null;
        const now = new Date().getTime();
        try {
            result = await this.recordedApiModel.executeCleanupPlan(this.planPath);
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'クリーンアップ実行に失敗',
            });
        }

        const diff = new Date().getTime() - now;
        if (diff < 1000) {
            await Util.sleep(1000 - diff);
        }

        this.isClearing = false;
        if (result !== null) {
            const deletedFileCount = result.deletedRecordedFileCount + result.deletedDropLogFileCount + result.deletedThumbnailFileCount;
            const removedDbCount = result.removedMissingVideoFileCount + result.removedMissingDropLogFileCount + result.removedMissingThumbnailFileCount;
            this.dialogModel = false;
            this.snackbarState.open({
                color: 'success',
                text: `クリーンアップ完了: ファイル${deletedFileCount}件, DB${removedDbCount}件`,
            });
        }
    }
}
</script>
