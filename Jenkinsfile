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
