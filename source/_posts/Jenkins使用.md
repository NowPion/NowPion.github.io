---
title: Jenkins安装与使用
date: 2026-03-20 12:00:00
tags: [Jenkins, Docker, CI/CD]
categories: [技术分享]
---

# Jenkins 安装与使用（Docker）

本文介绍如何使用 Docker 快速安装 Jenkins，并完成基础配置与常用构建流程。

---

## 使用 Docker 安装 Jenkins

### 1）拉取镜像

```bash
docker pull jenkins/jenkins:lts
```

### 2）创建数据卷

为了持久化 Jenkins 配置和构建数据，需要创建本地目录：

```bash
mkdir -p /opt/jenkins_home
chmod 777 /opt/jenkins_home
```

### 3）启动容器

```bash
docker run -d \
  --name jenkins \
  -p 8080:8080 \
  -p 50000:50000 \
  -v /opt/jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  jenkins/jenkins:lts
```

**参数说明：**
- `-d`：后台运行
- `--name jenkins`：容器名称
- `-p 8080:8080`：暴露 Web UI 端口
- `-p 50000:50000`：Jenkins agent 通信端口
- `-v /opt/jenkins_home:/var/jenkins_home`：数据持久化
- `-v /var/run/docker.sock:/var/run/docker.sock`：允许 Jenkins 调用 Docker

### 4）获取初始密码

```bash
docker logs jenkins | grep -A 5 "Please use the following password"
# 或者
cat /opt/jenkins_home/secrets/initialAdminPassword
```

### 5）访问 Jenkins

打开浏览器访问 `http://localhost:8080`，输入初始密码进行解锁。

---

## Jenkins 初始配置

### 1）安装推荐插件

解锁后会进入"自定义 Jenkins"页面，选择"安装推荐的插件"。常见插件包括：

- **Pipeline**：支持声明式和脚本化流水线
- **Blue Ocean**：提供现代化的 Pipeline 可视化
- **Git**：Git 版本控制集成
- **Maven Integration**：Maven 构建支持
- **Email Extension**：邮件通知
- **Slack Notification**：Slack 集成通知
- **Docker**：Docker 集成

### 2）创建管理员用户

按照提示创建第一个管理员用户，设置用户名、密码、邮箱等信息。

### 3）配置系统设置

进入"系统管理" → "系统配置"，配置以下内容：

- **Jenkins Location**：Jenkins URL（如 `http://your-domain:8080`）
- **邮件通知**：配置 SMTP 信息用于发送构建通知
- **污点标签**：设置执行器和代理标签

---

## 创建第一个 Pipeline 流水线

### 1）新建任务

点击"New Item"，输入任务名称，选择"Pipeline"类型。

### 2）编写 Jenkinsfile

在"Pipeline"部分选择"Pipeline script from SCM"，指定 Git 仓库。

示例 Jenkinsfile：

```groovy
pipeline {
    agent any
    
    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timestamps()
    }
    
    stages {
        stage('Git Checkout') {
            steps {
                echo '🔄 Checking out code...'
                git url: 'https://github.com/your-repo.git', 
                    branch: 'main'
            }
        }
        
        stage('Build') {
            steps {
                echo '🔨 Building project...'
                sh '''
                    chmod +x ./mvnw
                    ./mvnw clean package -DskipTests
                '''
            }
        }
        
        stage('Test') {
            steps {
                echo '🧪 Running tests...'
                sh './mvnw test'
            }
        }
        
        stage('Deploy Dev') {
            when {
                branch 'develop'
            }
            steps {
                echo '🚀 Deploying to dev environment...'
                sh './deploy.sh dev'
            }
        }
        
        stage('Deploy Prod') {
            when {
                branch 'main'
            }
            steps {
                echo '🚀 Deploying to production...'
                input message: '确认生产部署?', ok: 'Deploy'
                sh './deploy.sh prod'
            }
        }
    }
    
    post {
        always {
            echo '📊 Generating reports...'
            junit 'target/surefire-reports/**/*.xml'
        }
        
        success {
            echo '✅ Pipeline 成功！'
        }
        
        failure {
            echo '❌ Pipeline 失败！'
        }
    }
}
```

### 3）设置触发器

配置构建触发条件：
- **Poll SCM**：定期检查代码变更
- **Webhook**：Git 仓库提交时自动触发
- **定时构建**：指定时间自动构建

---

## 常用的 Jenkins 配置

### 1）配置 Git 凭证

进入"系统管理" → "Manage Credentials"，添加 SSH 或 HTTPS 凭证：

```bash
# 生成 SSH 密钥
ssh-keygen -t rsa -b 4096 -f ~/.ssh/jenkins_key

# 将公钥添加到 GitHub/GitLab
cat ~/.ssh/jenkins_key.pub
```

### 2）设置邮件通知

在"系统配置"中：
- 配置 SMTP 服务（Gmail、企业邮箱等）
- 设置发件人邮箱
- 在 Pipeline 中使用邮件步骤：

```groovy
post {
    failure {
        mail to: 'team@example.com',
             subject: "Build Failed: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
             body: "Build failed. Check console output at ${env.BUILD_URL}"
    }
}
```

### 3）配置 Docker 代理

在"系统管理" → "Manage Nodes and Clouds" → "Configure System"：

- 添加 Docker 云配置
- 设置 Docker host URI：`unix:///var/run/docker.sock`
- 配置 Docker 镜像模板

---

## 项目使用

编辑Jenkinsfile，实现自动拉取代码->打包->构建镜像->推送镜像仓库

```groovy
pipeline {
    agent any

    tools {
        maven 'Maven 3.9.5'
        jdk 'JDK 21'
    }

    environment {
        MAVEN_OPTS = '-Xmx1024m'
        APP_NAME = 'jenkins'
        APP_VERSION = '0.0.1-SNAPSHOT'
        REGISTRY = 'crpi-rd6sb3k81gnpszt1.cn-hangzhou.personal.cr.aliyuncs.com'
        REGISTRY_NAMESPACE = 'nie_jenkins'
        IMAGE_REPO = "${REGISTRY}/${REGISTRY_NAMESPACE}/${APP_NAME}"
    }



    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timestamps()
        timeout(time: 30, unit: 'MINUTES')
    }

    stages {
        stage('Checkout') {
            steps {
                echo 'Checking out code...'
                git(
                    branch: 'master',
                    url: 'https://gitee.com/niezidong/jenkins_test.git'
                )
            }
        }

        stage('Build Jar') {
            steps {
                echo 'Building application jar...'
                sh '''
                    chmod +x mvnw
                    ./mvnw clean package -DskipTests
                '''
                archiveArtifacts artifacts: 'target/*.jar', fingerprint: true
            }
        }

        stage('Build Docker Image') {
            steps {
                script {
                    env.IMAGE_TAG = "${BUILD_NUMBER}"
                    env.IMAGE_FULL_NAME = "${IMAGE_REPO}:${IMAGE_TAG}"
                }
                sh '''
                    docker build \
                      --build-arg JAR_FILE=target/${APP_NAME}-${APP_VERSION}.jar \
                      -t ${IMAGE_FULL_NAME} \
                      -t ${IMAGE_REPO}:latest \
                      .
                '''
            }
        }

        stage('Push Docker Image') {
            steps {
                sh '''
                    echo "Pushing image: ${IMAGE_FULL_NAME}"
                    docker push ${IMAGE_FULL_NAME}
                    docker push ${IMAGE_REPO}:latest
                '''

            }
        }

    }

    post {
        always {
            cleanWs()
        }
        success {
            echo 'Pipeline completed successfully.'
        }
        failure {
            echo 'Pipeline failed.'
        }
    }
}

```

---

## 性能优化建议

1. **增加执行器数量**：根据硬件配置在系统配置中增加执行器
2. **使用 Pipeline 缓存**：减少重复下载依赖
3. **配置构建队列优先级**：重要任务优先执行
4. **定期清理旧构建**：使用 `logRotator` 自动删除过期构建
5. **使用共享库**：在多个 Pipeline 间复用代码

---

## 参考资源

- [Jenkins 官方文档](https://www.jenkins.io/doc/)
- [Jenkins Pipeline 官方文档](https://www.jenkins.io/doc/book/pipeline/)
- [Jenkins 插件市场](https://plugins.jenkins.io/)
- [Docker Hub - Jenkins 镜像](https://hub.docker.com/r/jenkins/jenkins)

---

**更新日期**：2026-03-20